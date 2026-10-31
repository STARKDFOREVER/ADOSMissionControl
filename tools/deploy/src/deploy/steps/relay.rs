//! Start the remaining services (video relay, MQTT, Mission Control).

use super::{emit, fail_tail};
use crate::ctx::Ctx;
use crate::docker;
use crate::graph::{Step, StepKind, StepOutcome};
use crate::ui::activity;

pub(super) struct UpRest;
impl Step for UpRest {
    fn id(&self) -> &str {
        "up_rest"
    }
    fn requires(&self) -> &[&str] {
        &["write_config", "auth_keys", "mqtt_passwd"]
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        let sink = ctx.progress.clone();
        let root = ctx.repo_root.clone();
        let services = ctx.config.compose_services();
        // `--no-deps`: only the explicitly-listed services start. Without it,
        // `depends_on: convex-backend` on mission-control would drag
        // a rogue local convex-backend up under a managed-Convex / relay-only
        // deploy; in all-in-one the convex containers were already started by
        // up_convex, so they need no dependency pull here either (C2).
        let mut args: Vec<&str> = vec!["up", "-d", "--build", "--no-deps"];
        args.extend(services.iter().copied());
        sink.activity("up_rest", "building + starting services".into());
        let res = docker::compose_streamed(&root, &args, |l| {
            emit(&sink, "up_rest", activity::docker_activity, l)
        });
        if res.success() {
            StepOutcome::Ok
        } else {
            StepOutcome::Failed(fail_tail("starting the services failed", &res.stderr))
        }
    }
}
