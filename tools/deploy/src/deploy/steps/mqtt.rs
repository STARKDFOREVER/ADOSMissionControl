//! MQTT credentials and the broker ACL seed.

use super::{emit, fail_tail};
use crate::ctx::Ctx;
use crate::docker;
use crate::graph::{Step, StepKind, StepOutcome};
use crate::ui::activity;

pub(super) struct MqttPasswd;
impl Step for MqttPasswd {
    fn id(&self) -> &str {
        "mqtt_passwd"
    }
    fn requires(&self) -> &[&str] {
        &["write_config"]
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        if ctx.config.mqtt.is_managed() {
            return StepOutcome::Skipped;
        }
        let sink = ctx.progress.clone();
        // The repo root is already absolute (resolved at startup), so the
        // self-host dir is a plain absolute path Docker's `-v` accepts on every
        // OS. Avoid `canonicalize`, which yields a `\\?\C:\…` verbatim path on
        // Windows that `docker run -v` rejects.
        let mount = format!("{}:/work", ctx.selfhost_dir().display());
        // Idempotent re-deploy: `mosquitto_passwd -c` refuses to overwrite an
        // existing file ("File exists"), and on a re-run the passwd is already
        // bind-mounted into the running broker. Remove the prior host file so the
        // hash is regenerated cleanly from the current config. The password is
        // preserved across re-runs, so the broker's mounted copy stays valid.
        let _ = std::fs::remove_file(ctx.selfhost_dir().join("passwd"));
        sink.activity("mqtt_passwd", "hashing the MQTT password".into());
        let res = docker::streamed_in(
            "docker",
            &[
                "run",
                "--rm",
                "-v",
                &mount,
                "eclipse-mosquitto:2",
                "mosquitto_passwd",
                "-b",
                "-c",
                "/work/passwd",
                &ctx.config.mqtt_username,
                &ctx.config.mqtt_password,
            ],
            &ctx.repo_root,
            &[],
            |l| emit(&sink, "mqtt_passwd", activity::docker_activity, l),
        );
        if !res.success() {
            return StepOutcome::Failed(fail_tail(
                "creating the MQTT password failed",
                &res.stderr,
            ));
        }
        // The broker bind-mounts acl.conf as a FILE: it must exist before the
        // first `up`, or Docker creates a directory there. Seed it only when
        // absent -- on a re-run the sidecar's materialized device ACL is kept.
        match seed_acl(&ctx.repo_root) {
            Ok(()) => StepOutcome::Ok,
            Err(e) => StepOutcome::Failed(format!("seeding the broker ACL failed: {e}")),
        }
    }
}

/// Copy the committed service-account-only ACL policy to the generated ACL path when
/// that path holds no file yet.
pub(super) fn seed_acl(repo_root: &std::path::Path) -> std::io::Result<()> {
    let target = repo_root.join(crate::deploy::plan::ACL_FILE);
    if target.is_file() {
        return Ok(());
    }
    std::fs::copy(
        repo_root.join(crate::deploy::plan::ACL_POLICY_FILE),
        &target,
    )
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acl_seed_is_written_once_and_never_clobbers_the_synced_file() {
        let root = std::env::temp_dir().join(format!("ados-deploy-acl-{}", std::process::id()));
        let policy = root.join(crate::deploy::plan::ACL_POLICY_FILE);
        let target = root.join(crate::deploy::plan::ACL_FILE);
        std::fs::create_dir_all(policy.parent().unwrap()).unwrap();
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&policy, "user ados\ntopic read ados/#\n").unwrap();

        seed_acl(&root).unwrap();
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            "user ados\ntopic read ados/#\n"
        );

        // The sidecar has since materialized device entries; a re-deploy keeps them.
        std::fs::write(&target, "user ados-dev1\ntopic readwrite ados/dev1/#\n").unwrap();
        seed_acl(&root).unwrap();
        assert!(std::fs::read_to_string(&target)
            .unwrap()
            .contains("ados-dev1"));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
