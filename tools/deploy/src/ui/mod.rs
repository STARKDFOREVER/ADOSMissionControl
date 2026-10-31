//! Deployer-specific progress UI: the checklist groups and the subprocess-line
//! reducers. The renderers, theme and terminal come from `ados_term`.

pub mod activity;
pub mod groups;

pub use groups::{DEPLOY_FOOTER, DEPLOY_GROUPS, DEPLOY_SPEC};
