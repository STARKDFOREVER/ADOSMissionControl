//! The deploy checklist.
//!
//! The technical deploy steps are collapsed into human-readable groups so the
//! checklist reads at a glance; a group lights up when any of its member steps
//! starts and finalizes when all of them have a result.

use ados_term::progress::{GroupMap, ProgressSpec};

/// The deploy checklist groups. Each maps to one or more of the technical step
/// ids in the deploy chain; every chain step appears in exactly one group.
pub const DEPLOY_GROUPS: GroupMap = &[
    ("Checking system", &["preflight"]),
    ("Writing config", &["write_config"]),
    ("Starting Convex", &["up_convex", "wait_convex"]),
    (
        "Configuring Convex",
        &["admin_key", "push_functions", "auth_keys"],
    ),
    ("MQTT credentials", &["mqtt_passwd"]),
    ("Starting services", &["up_rest"]),
    ("Verifying", &["verify"]),
];

/// The full-screen footer reassurance line for the deploy flow.
pub const DEPLOY_FOOTER: &str =
    "First deploy pulls images + builds Mission Control. Safe to leave running.";

/// The deploy flow: groups plus wording.
pub const DEPLOY_SPEC: ProgressSpec = ProgressSpec {
    groups: DEPLOY_GROUPS,
    footer: DEPLOY_FOOTER,
    rich_title: "ADOS · deploying",
    skipped: "cached",
    plain_skipped: "already configured",
    interrupted: "Deploy interrupted. Re-run to finish — the deploy is idempotent.",
};

#[cfg(test)]
mod tests {
    use super::*;
    use ados_term::progress::group_index_for_step;

    #[test]
    fn group_lookup_resolves() {
        assert_eq!(group_index_for_step(DEPLOY_GROUPS, "preflight"), Some(0));
        assert_eq!(
            group_index_for_step(DEPLOY_GROUPS, "verify"),
            Some(DEPLOY_GROUPS.len() - 1)
        );
        assert_eq!(group_index_for_step(DEPLOY_GROUPS, "nope"), None);
    }
}
