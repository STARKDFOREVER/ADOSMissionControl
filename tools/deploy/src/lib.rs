//! `ados-deploy` — a Rust TUI that self-hosts the full Altnautica ADOS cloud
//! stack (Mission Control + Convex + MQTT + video relay) in one guided flow,
//! looking and behaving like the drone-agent installer.
//!
//! The theme, frame compositor, terminal backend, live progress renderers,
//! widgets and command runner come from `ados_term`; this crate holds the
//! deploy-specific surface (menu, wizard screens, the turnkey state machine,
//! docker/env orchestration).

pub mod checks;
pub mod cli;
pub mod ctx;
pub mod deploy;
pub mod docker;
pub mod env;
pub mod env_files;
pub mod graph;
pub mod host;
pub mod menu;
pub mod node;
pub mod result;
pub mod services;
pub mod shell;
pub mod ui;
pub mod wizard;
