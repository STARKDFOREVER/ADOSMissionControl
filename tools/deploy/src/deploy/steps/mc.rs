//! Verify the deployed stack: Mission Control and the services it reaches.

use std::time::Duration;

use super::convex_is_local;
use crate::ctx::Ctx;
use crate::docker;
use crate::graph::{Step, StepKind, StepOutcome};
use crate::wizard::state::Scope;

pub(super) struct Verify;
impl Step for Verify {
    fn id(&self) -> &str {
        "verify"
    }
    fn requires(&self) -> &[&str] {
        &["up_rest"]
    }
    fn kind(&self) -> StepKind {
        StepKind::Optional
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        let sink = ctx.progress.clone();
        let cfg = &ctx.config;
        // A short grace window: a just-built container (esp. the Next.js GCS)
        // takes a moment to bind after `up -d` returns. Polling — not a single
        // snapshot — is what makes a "not ready" verdict honest (C6).
        let grace = Duration::from_secs(20);
        let mut down: Vec<String> = Vec::new();

        let check_http = |name: &str, url: &str, down: &mut Vec<String>| {
            sink.activity("verify", format!("checking {name}"));
            let ok = docker::wait_http_ok(url, grace, |_| {});
            sink.sub_log(
                "verify",
                &format!("{name}: {}", if ok { "ok" } else { "not reachable" }),
            );
            if !ok {
                down.push(name.to_string());
            }
        };

        // Mission Control is only verified when this deploy actually started it.
        if cfg.gcs && matches!(cfg.scope, Scope::AllInOne) {
            check_http("Mission Control", &cfg.gcs_url(), &mut down);
        }
        if !cfg.video.is_managed() {
            let vurl = format!("http://{}:{}", cfg.host, cfg.ports.video);
            check_http("Video relay", &vurl, &mut down);
        }
        if convex_is_local(ctx) {
            let durl = format!("http://{}:{}", cfg.host, cfg.ports.dashboard);
            check_http("Convex dashboard", &durl, &mut down);
        }
        if !cfg.mqtt.is_managed() {
            sink.activity("verify", "checking MQTT broker".into());
            let ok = docker::wait_tcp_open(&cfg.host, cfg.ports.mqtt_tcp, grace);
            sink.sub_log(
                "verify",
                &format!("MQTT broker: {}", if ok { "ok" } else { "not reachable" }),
            );
            if !ok {
                down.push("MQTT broker".to_string());
            }
        }

        // Verify is Optional: a service that never came up degrades the deploy
        // (the completion card says "still warming up"), it never aborts.
        if down.is_empty() {
            StepOutcome::Ok
        } else {
            StepOutcome::Failed(format!("not reachable yet: {}", down.join(", ")))
        }
    }
}
