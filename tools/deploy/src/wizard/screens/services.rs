//! The services and ports stages, plus the URL / port prompts they share.

use ados_term::tty::Tty;
use ados_term::widgets::{checklist, confirm_card, text_input, CheckItem, Flow};
use ados_term::Theme;

use super::progress::Move;
use crate::wizard::state::{DeployConfig, Provision, Scope};

pub(super) fn stage_services(tty: &mut Tty, theme: &Theme, cfg: &mut DeployConfig) -> Move {
    if matches!(cfg.scope, Scope::RelayOnly) {
        // Relay-only: Convex + GCS are the operator's; capture the Convex site URL.
        let initial = cfg.convex.managed_url().unwrap_or("").to_string();
        return match ask_url(
            tty,
            theme,
            "Services",
            "Existing Convex site URL (e.g. https://convex.example.com)",
            &initial,
        ) {
            Flow::Value(url) => {
                cfg.convex = Provision::Managed { url };
                cfg.mqtt = spin_or_keep(&cfg.mqtt);
                cfg.video = spin_or_keep(&cfg.video);
                Move::Next
            }
            Flow::Back => Move::Back,
            Flow::Abort => Move::Abort,
        };
    }

    let items = vec![
        CheckItem {
            id: "convex".into(),
            label: "Convex backend".into(),
            benefit: "auth, fleet, missions, cloud relay".into(),
            checked: !cfg.convex.is_managed(),
            locked: false,
        },
        CheckItem {
            id: "gcs".into(),
            label: "Mission Control (web GCS)".into(),
            benefit: "the ground control station in the browser".into(),
            checked: true,
            locked: true,
        },
        CheckItem {
            id: "mqtt".into(),
            label: "MQTT relay".into(),
            benefit: "live telemetry to the browser over the cloud".into(),
            checked: !cfg.mqtt.is_managed(),
            locked: false,
        },
        CheckItem {
            id: "video".into(),
            label: "Video relay".into(),
            benefit: "drone video in the browser".into(),
            checked: !cfg.video.is_managed(),
            locked: false,
        },
    ];
    let picked = match checklist(
        tty,
        theme,
        "Services",
        "Which services should run locally? (uncheck to use your own)",
        items,
    ) {
        Flow::Value(v) => v,
        Flow::Back => return Move::Back,
        Flow::Abort => return Move::Abort,
    };

    for item in &picked {
        match item.id.as_str() {
            "gcs" => cfg.gcs = item.checked,
            "convex" => {
                if item.checked {
                    cfg.convex = Provision::SpinUp;
                } else {
                    match ask_managed(tty, theme, "Convex", &cfg.convex) {
                        Flow::Value(p) => cfg.convex = p,
                        Flow::Back => return Move::Back,
                        Flow::Abort => return Move::Abort,
                    }
                }
            }
            "mqtt" => {
                if item.checked {
                    cfg.mqtt = Provision::SpinUp;
                } else {
                    match ask_managed(tty, theme, "MQTT broker", &cfg.mqtt) {
                        Flow::Value(p) => cfg.mqtt = p,
                        Flow::Back => return Move::Back,
                        Flow::Abort => return Move::Abort,
                    }
                }
            }
            "video" => {
                if item.checked {
                    cfg.video = Provision::SpinUp;
                } else {
                    match ask_managed(tty, theme, "Video relay", &cfg.video) {
                        Flow::Value(p) => cfg.video = p,
                        Flow::Back => return Move::Back,
                        Flow::Abort => return Move::Abort,
                    }
                }
            }
            _ => {}
        }
    }
    Move::Next
}

pub(super) fn stage_ports(tty: &mut Tty, theme: &Theme, cfg: &mut DeployConfig) -> Move {
    let detail = vec![
        theme.dim("Defaults: Convex 3210/3211 · dashboard 6791 · Mission Control 4000"),
        theme.dim("MQTT 1883/9001 · video 3001"),
    ];
    match confirm_card(
        tty,
        theme,
        "Ports",
        "Use the default ports?",
        &detail,
        "Use defaults",
        "Customize",
        cfg.ports.is_default(),
    ) {
        Flow::Value(true) => Move::Next,
        Flow::Value(false) => customize_ports(tty, theme, cfg),
        Flow::Back => Move::Back,
        Flow::Abort => Move::Abort,
    }
}

pub(super) fn customize_ports(tty: &mut Tty, theme: &Theme, cfg: &mut DeployConfig) -> Move {
    let mut p = cfg.ports;
    // (label, current, setter-index)
    let fields: [(&str, u16); 7] = [
        ("Convex client API", p.convex_client),
        ("Convex site / HTTP actions", p.convex_site),
        ("Convex dashboard", p.dashboard),
        ("Mission Control", p.gcs),
        ("MQTT TCP", p.mqtt_tcp),
        ("MQTT WebSocket", p.mqtt_ws),
        ("Video relay", p.video),
    ];
    let mut vals = [0u16; 7];
    for (idx, (label, cur)) in fields.iter().enumerate() {
        match ask_port(tty, theme, label, *cur) {
            Flow::Value(v) => vals[idx] = v,
            Flow::Back => return Move::Back,
            Flow::Abort => return Move::Abort,
        }
    }
    p.convex_client = vals[0];
    p.convex_site = vals[1];
    p.dashboard = vals[2];
    p.gcs = vals[3];
    p.mqtt_tcp = vals[4];
    p.mqtt_ws = vals[5];
    p.video = vals[6];
    cfg.ports = p;
    Move::Next
}

/// Keep a managed provision, else spin up.
pub(super) fn spin_or_keep(current: &Provision) -> Provision {
    match current {
        Provision::Managed { url } if !url.is_empty() => Provision::Managed { url: url.clone() },
        _ => Provision::SpinUp,
    }
}

/// Prompt for an existing service URL → `Provision::Managed`.
pub(super) fn ask_managed(
    tty: &mut Tty,
    theme: &Theme,
    label: &str,
    current: &Provision,
) -> Flow<Provision> {
    let initial = current.managed_url().unwrap_or("").to_string();
    match ask_url(
        tty,
        theme,
        "Services",
        &format!("Existing {label} URL"),
        &initial,
    ) {
        Flow::Value(url) => Flow::Value(Provision::Managed { url }),
        Flow::Back => Flow::Back,
        Flow::Abort => Flow::Abort,
    }
}

/// A URL text input (allows the URL character set), non-empty.
pub(super) fn ask_url(
    tty: &mut Tty,
    theme: &Theme,
    section: &str,
    prompt: &str,
    initial: &str,
) -> Flow<String> {
    text_input(
        tty,
        theme,
        section,
        prompt,
        initial,
        "URL",
        |raw: &mut String, ch: char| {
            if !ch.is_whitespace() {
                raw.push(ch);
            }
        },
        |raw: &str| {
            if raw.is_empty() {
                None
            } else {
                Some(raw.to_string())
            }
        },
        |raw: &str| {
            if raw.trim().is_empty() {
                Some("Enter a URL".to_string())
            } else {
                None
            }
        },
    )
}

/// A port text input (digits only, 1..=65535).
pub(super) fn ask_port(tty: &mut Tty, theme: &Theme, label: &str, current: u16) -> Flow<u16> {
    let out = text_input(
        tty,
        theme,
        "Ports",
        &format!("{label} port"),
        &current.to_string(),
        "port",
        |raw: &mut String, ch: char| {
            if ch.is_ascii_digit() && raw.len() < 5 {
                raw.push(ch);
            }
        },
        // Live preview flags a port already bound on localhost (a non-blocking
        // hint — on a re-deploy the operator's own containers hold their ports).
        |raw: &str| {
            let note = match raw.parse::<u16>() {
                Ok(p) if p >= 1 && !crate::checks::port_free(p) => " · in use",
                _ => "",
            };
            Some(format!("bind :{raw}{note}"))
        },
        |raw: &str| match raw.parse::<u32>() {
            Ok(n) if (1..=65535).contains(&n) => None,
            _ => Some("Enter a port between 1 and 65535".to_string()),
        },
    );
    match out {
        Flow::Value(s) => Flow::Value(s.parse().unwrap_or(current)),
        Flow::Back => Flow::Back,
        Flow::Abort => Flow::Abort,
    }
}
