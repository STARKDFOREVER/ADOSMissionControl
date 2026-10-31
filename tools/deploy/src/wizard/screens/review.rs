//! The review stage: the read-only summary and the Deploy / change / cancel pick.

use ados_term::tty::Tty;
use ados_term::widgets::{select_list, summary_select, Choice, Flow};
use ados_term::Theme;

use super::progress::{idx_of, Move, Stage};
use crate::wizard::state::{DeployConfig, Provision, Scope, Tls};

pub(super) fn stage_review(tty: &mut Tty, theme: &Theme, cfg: &DeployConfig) -> Move {
    let summary = review_summary(theme, cfg);
    let choices = [
        Choice::new("deploy", "Deploy now", None),
        Choice::new("change", "Change an answer", None),
        Choice::new("cancel", "Cancel", None),
    ];
    match summary_select(
        tty,
        theme,
        "Review",
        "Ready to deploy",
        &summary,
        &choices,
        0,
    ) {
        Flow::Value(0) => Move::Finish,
        Flow::Value(1) => change_picker(tty, theme),
        Flow::Value(_) => Move::Abort,
        Flow::Back => Move::Back,
        Flow::Abort => Move::Abort,
    }
}

pub(super) fn change_picker(tty: &mut Tty, theme: &Theme) -> Move {
    let choices = [
        Choice::new("scope", "Scope", None),
        Choice::new("services", "Services", None),
        Choice::new("host", "Address", None),
        Choice::new("ports", "Ports", None),
        Choice::new("tls", "Access", None),
    ];
    match select_list(tty, theme, "Review", "Which answer?", &choices, 0) {
        Flow::Value(i) => Move::Jump(i), // stages 0..=4 map 1:1
        Flow::Back => Move::Jump(idx_of(Stage::Review)),
        Flow::Abort => Move::Abort,
    }
}

/// The read-only review summary block.
pub(super) fn review_summary(theme: &Theme, cfg: &DeployConfig) -> Vec<String> {
    let kv = |k: &str, v: &str| format!("  {}  {}", theme.dim(&format!("{k:<14}")), v);
    let prov = |p: &Provision, spin: &str| match p {
        Provision::SpinUp => spin.to_string(),
        Provision::Managed { url } if url.is_empty() => "not deployed".to_string(),
        Provision::Managed { url } => format!("managed · {url}"),
    };
    let scope = match cfg.scope {
        Scope::AllInOne => "all-in-one",
        Scope::RelayOnly => "relay only",
    };
    let tls = match cfg.tls {
        Tls::HttpLan => "HTTP on the LAN",
        Tls::CustomProxy => "custom reverse proxy",
    };
    vec![
        kv("Address", &cfg.host),
        kv("Scope", scope),
        kv("Convex", &prov(&cfg.convex, "spin up locally")),
        kv(
            "Mission Ctrl",
            if cfg.gcs {
                "spin up locally"
            } else {
                "not deployed"
            },
        ),
        kv("MQTT", &prov(&cfg.mqtt, "spin up locally")),
        kv("Video", &prov(&cfg.video, "spin up locally")),
        kv(
            "Ports",
            if cfg.ports.is_default() {
                "defaults"
            } else {
                "custom"
            },
        ),
        kv("Access", tls),
    ]
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;

    #[test]
    fn review_summary_reflects_config() {
        let theme = Theme {
            ascii: true,
            tier: ados_term::theme::ColorTier::None,
        };
        let mut cfg = DeployConfig::default();
        cfg.host = "192.168.1.50".into();
        cfg.video = Provision::Managed {
            url: "wss://video.example.com".into(),
        };
        let s = review_summary(&theme, &cfg).join("\n");
        assert!(s.contains("192.168.1.50"));
        assert!(s.contains("managed · wss://video.example.com"));
    }
}
