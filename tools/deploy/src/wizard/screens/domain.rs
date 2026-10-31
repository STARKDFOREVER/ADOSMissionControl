//! The scope, address and access (TLS) stages.

use ados_term::tty::Tty;
use ados_term::widgets::{confirm_card, select_list, text_input, Choice, Flow};
use ados_term::Theme;

use super::progress::{idx_of, Move, Stage};
use crate::wizard::state::{DeployConfig, Scope, Tls};

pub(super) fn stage_scope(tty: &mut Tty, theme: &Theme, cfg: &mut DeployConfig) -> Move {
    let choices = [
        Choice::new(
            "all",
            "All-in-one on this host",
            Some("Convex + Mission Control + MQTT + video, everything local"),
        ),
        Choice::new(
            "relay",
            "Relay layers only",
            Some("MQTT + video, pointed at an existing Convex + Mission Control"),
        ),
    ];
    let default = match cfg.scope {
        Scope::AllInOne => 0,
        Scope::RelayOnly => 1,
    };
    match select_list(
        tty,
        theme,
        "Scope",
        "What do you want to deploy?",
        &choices,
        default,
    ) {
        Flow::Value(0) => {
            cfg.scope = Scope::AllInOne;
            cfg.gcs = true;
            Move::Next
        }
        Flow::Value(_) => {
            cfg.scope = Scope::RelayOnly;
            cfg.gcs = false;
            Move::Next
        }
        Flow::Back => Move::Back,
        Flow::Abort => Move::Abort,
    }
}

pub(super) fn stage_host(tty: &mut Tty, theme: &Theme, cfg: &mut DeployConfig) -> Move {
    let gcs_port = cfg.ports.gcs;
    let https = cfg.tls.is_https();
    let scheme = if https { "https" } else { "http" };
    match text_input(
        tty,
        theme,
        "Address",
        "Where do browsers and drones reach this stack? (LAN IP or domain)",
        &cfg.host,
        "Mission Control",
        |raw: &mut String, ch: char| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' {
                raw.push(ch.to_ascii_lowercase());
            }
        },
        move |raw: &str| {
            if raw.is_empty() {
                None
            } else {
                Some(format!("{scheme}://{raw}:{gcs_port}"))
            }
        },
        |raw: &str| {
            if raw.trim().is_empty() {
                Some("Enter a LAN IP (e.g. 192.168.1.50) or a domain".to_string())
            } else {
                None
            }
        },
    ) {
        Flow::Value(h) => {
            cfg.host = h;
            Move::Next
        }
        Flow::Back => Move::Back,
        Flow::Abort => Move::Abort,
    }
}

pub(super) fn stage_tls(tty: &mut Tty, theme: &Theme, cfg: &mut DeployConfig) -> Move {
    let choices = [
        Choice::new(
            "http",
            "HTTP on the LAN",
            Some("simplest; browser cloud mode stays off"),
        ),
        Choice::new(
            "proxy",
            "My own reverse proxy",
            Some("you terminate TLS in front of the stack"),
        ),
    ];
    let default = match cfg.tls {
        Tls::HttpLan => 0,
        Tls::CustomProxy => 1,
    };
    match select_list(
        tty,
        theme,
        "Access",
        "How is the stack reached?",
        &choices,
        default,
    ) {
        Flow::Value(0) => {
            // Warn that cloud mode won't engage on plain HTTP.
            let detail = vec![
                theme.dim("Mission Control's browser cloud mode only activates over HTTPS."),
                theme.dim("On HTTP, drones appear over the LAN / direct-agent path."),
                theme.dim("For internet fleet control, terminate TLS with a reverse proxy."),
            ];
            match confirm_card(
                tty,
                theme,
                "Access",
                "Continue with HTTP on the LAN?",
                &detail,
                "Continue",
                "Go back",
                true,
            ) {
                Flow::Value(true) => {
                    cfg.tls = Tls::HttpLan;
                    Move::Next
                }
                Flow::Value(false) => Move::Jump(idx_of(Stage::Tls)),
                Flow::Back => Move::Back,
                Flow::Abort => Move::Abort,
            }
        }
        Flow::Value(_) => {
            cfg.tls = Tls::CustomProxy;
            Move::Next
        }
        Flow::Back => Move::Back,
        Flow::Abort => Move::Abort,
    }
}
