//! Convex bring-up: start the backend, wait for it, mint the admin key, push
//! the functions and set the auth keys.

use std::time::Duration;

use super::{convex_is_local, emit, fail_tail, parse_quoted};
use crate::ctx::Ctx;
use crate::docker;
use crate::env_files;
use crate::graph::{Step, StepKind, StepOutcome};
use crate::services::SVC_CONVEX_BACKEND;
use crate::ui::activity;

pub(super) struct UpConvex;
impl Step for UpConvex {
    fn id(&self) -> &str {
        "up_convex"
    }
    fn requires(&self) -> &[&str] {
        &["write_config"]
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        if !convex_is_local(ctx) {
            return StepOutcome::Skipped;
        }
        let sink = ctx.progress.clone();
        let root = ctx.repo_root.clone();
        let res = docker::compose_streamed(
            &root,
            &["up", "-d", "convex-backend", "convex-dashboard"],
            |l| emit(&sink, "up_convex", activity::docker_activity, l),
        );
        if res.success() {
            StepOutcome::Ok
        } else {
            StepOutcome::Failed(fail_tail("starting Convex failed", &res.stderr))
        }
    }
}

pub(super) struct WaitConvex;
impl Step for WaitConvex {
    fn id(&self) -> &str {
        "wait_convex"
    }
    fn requires(&self) -> &[&str] {
        &["up_convex"]
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        if !convex_is_local(ctx) {
            return StepOutcome::Skipped;
        }
        let sink = ctx.progress.clone();
        let url = format!("{}/version", ctx.config.convex_cloud_origin());
        sink.activity("wait_convex", "waiting for Convex :3210".into());
        let ok = docker::wait_http_ok(&url, Duration::from_secs(120), |s| {
            sink.activity("wait_convex", format!("waiting for Convex :3210 ({s}s)"));
        });
        if ok {
            StepOutcome::Ok
        } else {
            StepOutcome::Failed(
                "Convex did not become ready within 120s — check `docker compose logs convex-backend`".into(),
            )
        }
    }
}

pub(super) struct AdminKey;
impl Step for AdminKey {
    fn id(&self) -> &str {
        "admin_key"
    }
    fn requires(&self) -> &[&str] {
        &["wait_convex"]
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        if !convex_is_local(ctx) {
            return StepOutcome::Skipped;
        }
        let sink = ctx.progress.clone();
        let root = ctx.repo_root.clone();
        sink.activity("admin_key", "deriving the admin key".into());
        let res = docker::compose_capture(
            &root,
            &["exec", "-T", SVC_CONVEX_BACKEND, "./generate_admin_key.sh"],
        );
        let key = res
            .stdout
            .lines()
            .map(str::trim)
            .find(|l| l.contains('|') && !l.is_empty());
        match key {
            Some(k) => {
                ctx.admin_key = Some(k.to_string());
                StepOutcome::Ok
            }
            None => StepOutcome::Failed(fail_tail(
                "could not retrieve the Convex admin key",
                &res.stderr,
            )),
        }
    }
}

pub(super) struct PushFunctions;
impl Step for PushFunctions {
    fn id(&self) -> &str {
        "push_functions"
    }
    fn requires(&self) -> &[&str] {
        &["admin_key"]
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        if !convex_is_local(ctx) {
            return StepOutcome::Skipped;
        }
        let Some(key) = ctx.admin_key.clone() else {
            return StepOutcome::Failed("admin key missing (retrieval step did not run)".into());
        };
        let sink = ctx.progress.clone();
        let root = ctx.repo_root.clone();
        let url = ctx.config.convex_cloud_origin();
        sink.activity("push_functions", "pushing Convex functions".into());
        let cmd = docker::convex_command(
            "npx",
            &["convex", "deploy", "--yes", "--typecheck", "disable"],
            &root,
            &url,
            &key,
        );
        let res = ados_term::exec::run_streamed_cmd(cmd, |l| {
            emit(&sink, "push_functions", activity::convex_activity, l)
        });
        if res.success() {
            StepOutcome::Ok
        } else {
            StepOutcome::Failed(fail_tail("pushing Convex functions failed", &res.stderr))
        }
    }
}

pub(super) struct AuthKeys;
impl Step for AuthKeys {
    fn id(&self) -> &str {
        "auth_keys"
    }
    fn requires(&self) -> &[&str] {
        &["push_functions"]
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        if !convex_is_local(ctx) {
            return StepOutcome::Skipped;
        }
        let Some(key) = ctx.admin_key.clone() else {
            return StepOutcome::Failed("admin key missing".into());
        };
        let sink = ctx.progress.clone();
        let root = ctx.repo_root.clone();
        let url = ctx.config.convex_cloud_origin();

        sink.activity("auth_keys", "generating RS256 auth keys".into());
        // Full capture (no line cap): the PEM key is ~1.7 KB on one line, which
        // the streaming runners would truncate. `node_command` resolves the
        // Windows launcher; on unix it is a plain `node` spawn.
        let mut gen_cmd = crate::node::node_command("node", &["scripts/generate-auth-keys.mjs"]);
        gen_cmd.current_dir(&root);
        let gen = ados_term::exec::run_cmd(gen_cmd);
        if !gen.success() {
            return StepOutcome::Failed(fail_tail("generating auth keys failed", &gen.stderr));
        }
        let jwt = parse_quoted(&gen.stdout, "JWT_PRIVATE_KEY");
        let jwks = parse_quoted(&gen.stdout, "JWKS");
        let (Some(jwt), Some(jwks)) = (jwt, jwks) else {
            return StepOutcome::Failed("could not parse the generated auth keys".into());
        };

        // Set the auth keys, the derived Convex env vars (SITE_URL, relay URLs)
        // and the relay's viewer-token secret.
        let mut pairs: Vec<(String, String)> =
            vec![("JWT_PRIVATE_KEY".into(), jwt), ("JWKS".into(), jwks)];
        for (k, v) in env_files::convex_env_vars(&ctx.config)
            .into_iter()
            .chain(env_files::convex_secret_env_vars(&ctx.config))
        {
            pairs.push((k.to_string(), v));
        }
        for (k, v) in &pairs {
            sink.activity("auth_keys", format!("setting {k}"));
            // `--` terminates option parsing: the JWT PEM value starts with
            // "-----BEGIN", which the CLI would otherwise read as a flag.
            let cmd = docker::convex_command(
                "npx",
                &["convex", "env", "set", "--", k, v],
                &root,
                &url,
                &key,
            );
            let res = ados_term::exec::run_streamed_cmd(cmd, |l| {
                emit(&sink, "auth_keys", activity::convex_activity, l)
            });
            if !res.success() {
                return StepOutcome::Failed(fail_tail(&format!("setting {k} failed"), &res.stderr));
            }
        }
        StepOutcome::Ok
    }
}
