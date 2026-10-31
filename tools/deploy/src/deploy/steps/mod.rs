//! The turnkey deploy step machine — one `graph::Step` per stage, in dependency
//! order, driven by `graph::run_graph`. A Required failure aborts (no half-stack);
//! Optional failures degrade. Each step streams its subprocess output to the
//! live split-view via the progress sink, and skips cleanly when its work does
//! not apply (a managed service, or the relay-only scope).

mod convex;
mod mc;
mod mqtt;
mod relay;

use ados_term::progress::ProgressSink;

use crate::checks;
use crate::ctx::Ctx;
use crate::docker;
use crate::env_files;
use crate::graph::{Step, StepKind, StepOutcome};
use crate::wizard::state::Scope;
use convex::{AdminKey, AuthKeys, PushFunctions, UpConvex, WaitConvex};
use mc::Verify;
use mqtt::MqttPasswd;
use relay::UpRest;

/// The full ordered step set for a deploy.
pub fn build_steps() -> Vec<Box<dyn Step>> {
    vec![
        Box::new(Preflight),
        Box::new(WriteConfig),
        Box::new(UpConvex),
        Box::new(WaitConvex),
        Box::new(AdminKey),
        Box::new(PushFunctions),
        Box::new(AuthKeys),
        Box::new(MqttPasswd),
        Box::new(UpRest),
        Box::new(Verify),
    ]
}

/// Emit a raw line into the step's log tail and, when a reducer matches, set the
/// curated headline for the live-detail pane.
pub(super) fn emit(sink: &ProgressSink, id: &str, reduce: fn(&str) -> Option<String>, line: &str) {
    sink.sub_log(id, line);
    if let Some(h) = reduce(line) {
        sink.activity(id, h);
    }
}

/// Whether Convex is spun up locally (all-in-one and not managed).
pub(super) fn convex_is_local(ctx: &Ctx) -> bool {
    matches!(ctx.config.scope, Scope::AllInOne) && !ctx.config.convex.is_managed()
}

// ── preflight ───────────────────────────────────────────────────────────────

struct Preflight;
impl Step for Preflight {
    fn id(&self) -> &str {
        "preflight"
    }
    fn requires(&self) -> &[&str] {
        &[]
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        let sink = ctx.progress.clone();
        sink.activity("preflight", "checking Docker".into());
        if !docker::docker_present() {
            return StepOutcome::Failed("Docker is not installed. Install Docker Desktop.".into());
        }
        if !docker::is_docker_running() {
            return StepOutcome::Failed(
                "the Docker daemon is not running — start Docker Desktop and retry".into(),
            );
        }
        if convex_is_local(ctx) && !checks::node_present() {
            return StepOutcome::Failed(
                "Node.js is not installed (needed to push Convex functions). Install Node 20+."
                    .into(),
            );
        }
        // Port availability is advisory: a re-deploy's ports are held by our own
        // containers, so a conflict here is not fatal.
        for (label, port) in ctx.config.ports.labeled() {
            if !checks::port_free(port) {
                sink.sub_log("preflight", &format!("port {port} ({label}) is in use"));
            }
        }
        StepOutcome::Ok
    }
}

// ── write config ─────────────────────────────────────────────────────────────

struct WriteConfig;
impl Step for WriteConfig {
    fn id(&self) -> &str {
        "write_config"
    }
    fn requires(&self) -> &[&str] {
        &["preflight"]
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        let sink = ctx.progress.clone();
        let selfhost = ctx.selfhost_dir();
        // Guard: a spun-up backend needs a real instance secret (the admin key is
        // derived from it) and a real MQTT password. An empty one means the OS RNG
        // failed at mint time — fail loudly rather than write a weak/empty secret.
        if !ctx.config.convex.is_managed() && ctx.config.instance_secret.is_empty() {
            return StepOutcome::Failed(
                "the Convex instance secret is empty (system RNG failed) — cannot deploy".into(),
            );
        }
        if !ctx.config.mqtt.is_managed() && ctx.config.mqtt_password.is_empty() {
            return StepOutcome::Failed(
                "the MQTT password is empty (system RNG failed) — cannot deploy".into(),
            );
        }
        if !ctx.config.mqtt.is_managed() && ctx.config.mqtt_auth_relay_secret.is_empty() {
            return StepOutcome::Failed(
                "the broker auth-sync secret is empty (system RNG failed) — cannot deploy".into(),
            );
        }
        if !ctx.config.video.is_managed() && ctx.config.video_relay_secret.is_empty() {
            return StepOutcome::Failed(
                "the video relay secret is empty (system RNG failed) — cannot deploy".into(),
            );
        }
        sink.activity("write_config", "writing .env".into());
        let env_path = selfhost.join(".env");
        if let Err(e) = env_files::write_secret_file(
            &ctx.repo_root,
            &env_path,
            &env_files::render_env(&ctx.config),
        ) {
            return StepOutcome::Failed(e.to_string());
        }
        if let Some(ov) = env_files::render_override(&ctx.config) {
            let ov_path = selfhost.join("docker-compose.override.yml");
            sink.activity("write_config", "writing port overrides".into());
            if let Err(e) = env_files::write_secret_file(&ctx.repo_root, &ov_path, &ov) {
                return StepOutcome::Failed(e.to_string());
            }
        }
        StepOutcome::Ok
    }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/// Extract the value of a `KEY="value"` or `KEY='value'` line from `text`.
pub(super) fn parse_quoted(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            let rest = rest.trim_start_matches('=').trim();
            let bytes = rest.as_bytes();
            if bytes.len() >= 2 {
                let q = bytes[0];
                if (q == b'"' || q == b'\'') && rest.ends_with(q as char) {
                    return Some(rest[1..rest.len() - 1].to_string());
                }
            }
        }
    }
    None
}

/// A failure message with a short tail of the subprocess stderr appended.
pub(super) fn fail_tail(msg: &str, stderr: &str) -> String {
    let tail: Vec<&str> = stderr
        .lines()
        .rev()
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if tail.is_empty() {
        msg.to_string()
    } else {
        format!("{msg}: {}", tail.join(" · "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::topo_order;

    #[test]
    fn steps_form_a_valid_ordered_graph() {
        let steps = build_steps();
        let order = topo_order(&steps).expect("deploy graph orders");
        let pos = |id: &str| order.iter().position(|x| x == id).unwrap();
        assert!(pos("preflight") < pos("write_config"));
        assert!(pos("up_convex") < pos("wait_convex"));
        assert!(pos("admin_key") < pos("push_functions"));
        assert!(pos("push_functions") < pos("auth_keys"));
        assert!(pos("auth_keys") < pos("up_rest"));
        assert!(pos("mqtt_passwd") < pos("up_rest"));
        assert!(pos("up_rest") < pos("verify"));
    }

    #[test]
    fn parse_quoted_handles_both_quote_styles() {
        let text = "# comment\nJWT_PRIVATE_KEY=\"-----BEGIN abc def-----\"\nJWKS='{\"keys\":[]}'\n";
        assert_eq!(
            parse_quoted(text, "JWT_PRIVATE_KEY").as_deref(),
            Some("-----BEGIN abc def-----")
        );
        assert_eq!(parse_quoted(text, "JWKS").as_deref(), Some("{\"keys\":[]}"));
        assert!(parse_quoted(text, "MISSING").is_none());
    }

    // The generated auth keys arrive as one long single-line value: a PEM with
    // embedded `\n`, base64 padding `=`, and `+`/`/`, and a JWKS JSON that also
    // contains `=`. This is the exact shape the key-set step parses, so pin it.
    #[test]
    fn parse_quoted_handles_a_long_single_line_pem_and_jwks() {
        let pem = "-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ+a/b==\\n-----END PRIVATE KEY-----\\n";
        let jwks = r#"{"keys":[{"use":"sig","kty":"RSA","n":"abc+def/ghi=","e":"AQAB"}]}"#;
        let text = format!("# generated\nJWT_PRIVATE_KEY=\"{pem}\"\nJWKS='{jwks}'\n");
        assert_eq!(parse_quoted(&text, "JWT_PRIVATE_KEY").as_deref(), Some(pem));
        assert_eq!(parse_quoted(&text, "JWKS").as_deref(), Some(jwks));
    }

    #[test]
    fn convex_is_local_only_for_all_in_one_spin_up() {
        use crate::wizard::state::{Provision, Scope};
        let mut ctx = Ctx::for_test();
        // Default config: all-in-one, spin up → local.
        assert!(convex_is_local(&ctx));
        // Managed Convex → not local (no backend container to configure).
        ctx.config.convex = Provision::Managed {
            url: "https://convex.example.com".into(),
        };
        assert!(!convex_is_local(&ctx));
        // Relay-only scope → not local even when spinning up.
        ctx.config.convex = Provision::SpinUp;
        ctx.config.scope = Scope::RelayOnly;
        assert!(!convex_is_local(&ctx));
    }

    #[test]
    fn fail_tail_appends_stderr_tail() {
        let s = fail_tail("boom", "line1\nline2\nline3\nline4");
        assert!(s.starts_with("boom: "));
        assert!(s.contains("line4"));
        assert!(!s.contains("line1"));
    }
}
