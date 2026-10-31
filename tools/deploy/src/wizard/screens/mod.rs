//! The deploy wizard's interactive stages, in the installer's house style.
//!
//! Each stage reads/writes the shared [`DeployConfig`] via the widget grammar
//! (`select_list`, `checklist`, `confirm_card`, `text_input`).
//! Esc goes back a stage; Ctrl-C aborts the whole wizard. The Review stage
//! offers Deploy / change an answer / cancel. The wizard returns the finished
//! config (or `None` on cancel); the caller runs the plan or the state machine.

mod domain;
mod progress;
mod review;
mod secrets;
mod services;

use std::path::Path;

use ados_term::tty::Tty;
use ados_term::Theme;

use crate::cli::Args;
use crate::wizard::state::DeployConfig;
use domain::{stage_host, stage_scope, stage_tls};
use progress::{Move, Stage};
use review::stage_review;
pub use secrets::config_from_env;
use secrets::{prefill_from_args, prefill_from_existing};
use services::{stage_ports, stage_services};

/// Run the wizard. Returns the finished config, or `None` on cancel/abort/no-tty.
pub fn run(theme: &Theme, args: &Args, repo_root: &Path) -> anyhow::Result<Option<DeployConfig>> {
    let mut tty = match Tty::open_stdio()? {
        Some(t) => t,
        None => return Ok(None),
    };
    let mut cfg = DeployConfig::with_generated_secrets();
    prefill_from_existing(&mut cfg, repo_root);
    prefill_from_args(&mut cfg, args);

    let mut i = 0usize;
    loop {
        let stage = Stage::ALL[i];
        tty.set_chrome(i + 1, Stage::ALL.len(), stage.label());
        let mv = match stage {
            Stage::Scope => stage_scope(&mut tty, theme, &mut cfg),
            Stage::Services => stage_services(&mut tty, theme, &mut cfg),
            Stage::Host => stage_host(&mut tty, theme, &mut cfg),
            Stage::Ports => stage_ports(&mut tty, theme, &mut cfg),
            Stage::Tls => stage_tls(&mut tty, theme, &mut cfg),
            Stage::Review => stage_review(&mut tty, theme, &cfg),
        };
        match mv {
            Move::Next => i = (i + 1).min(Stage::ALL.len() - 1),
            Move::Back => {
                if i == 0 {
                    return Ok(None);
                }
                i -= 1;
            }
            Move::Abort => return Ok(None),
            Move::Jump(j) => i = j.min(Stage::ALL.len() - 1),
            Move::Finish => return Ok(Some(cfg)),
        }
    }
}

/// Build a config non-interactively from defaults + supplied flags (for
/// `--plan` and `--non-interactive`).
pub fn config_from_args(args: &Args, repo_root: &Path) -> DeployConfig {
    let mut c = DeployConfig::with_generated_secrets();
    prefill_from_existing(&mut c, repo_root);
    prefill_from_args(&mut c, args);
    c
}
