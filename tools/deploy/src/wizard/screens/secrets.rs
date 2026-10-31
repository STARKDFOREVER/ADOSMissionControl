//! Config seeding: reuse the secrets and settings of an existing deploy, and
//! apply the non-interactive flags.

use std::path::Path;

use crate::cli::Args;
use crate::wizard::state::{mint_hex, DeployConfig, Provision};

/// Reconstruct the deploy config from an existing `tools/selfhost/.env` (+ the
/// port override), so Reconfigure / Upgrade / the reach-links surfaces target the
/// same backend a prior deploy created. Recovers the host, ports, instance
/// name/secret, MQTT principal, and whether Convex is spun up locally or managed.
///
/// Honest boundary: `.env` records the all-in-one spin-up shape (scope + the
/// MQTT/video provisioning choice are not persisted), so this returns an
/// all-in-one config; a managed-relay redeploy should use the wizard or the
/// non-interactive flags. The instance secret makes the derived admin key stable,
/// which is the load-bearing idempotency guarantee.
pub fn config_from_env(repo_root: &Path) -> Option<DeployConfig> {
    let get = |k: &str| crate::env_files::read_env_var(repo_root, k);
    // CONVEX_CLOUD_ORIGIN always carries the real local host (`http://<host>:<p>`),
    // even for a managed Convex — unlike NEXT_PUBLIC_CONVEX_URL, which becomes the
    // managed domain. So the host comes from the cloud origin.
    let cloud_origin = get("CONVEX_CLOUD_ORIGIN")?;
    let host = url_host(&cloud_origin);

    let mut cfg = DeployConfig {
        host: host.clone(),
        ports: crate::env_files::read_existing_ports(repo_root),
        ..DeployConfig::default()
    };
    if let Some(v) = get("CONVEX_INSTANCE_NAME") {
        cfg.instance_name = v;
    }
    if let Some(v) = get("CONVEX_INSTANCE_SECRET") {
        cfg.instance_secret = v;
    }
    if let Some(v) = get("MQTT_USERNAME") {
        cfg.mqtt_username = v;
    }
    if let Some(v) = get("MQTT_PASSWORD") {
        cfg.mqtt_password = v;
    }
    // A stack deployed before the relay secret was provisioned has none on disk;
    // mint one so the next upgrade writes it to both the relay and Convex.
    cfg.video_relay_secret = get("VIDEO_RELAY_SECRET").unwrap_or_else(|| mint_hex(32));
    // Same for the broker auth-sync bearer: minted when absent, reused after.
    cfg.mqtt_auth_relay_secret = get("MQTT_AUTH_RELAY_SECRET").unwrap_or_else(|| mint_hex(32));
    // Convex is managed when the browser URL points somewhere other than the
    // local backend host.
    if let Some(npc) = get("NEXT_PUBLIC_CONVEX_URL") {
        if url_host(&npc) != host {
            cfg.convex = Provision::Managed { url: npc };
        }
    }
    Some(cfg)
}

/// The host component of a `scheme://host[:port][/path]` URL.
pub(super) fn url_host(url: &str) -> String {
    let after_scheme = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    after_scheme
        .split(['/', ':'])
        .next()
        .unwrap_or("127.0.0.1")
        .to_string()
}

/// Seed the config from an existing deploy (`.env` + override): reuse the
/// secrets (a stable admin key → idempotent re-run), and pre-fill the host,
/// ports, and Convex provisioning so a reconfigure shows the current values.
pub(super) fn prefill_from_existing(cfg: &mut DeployConfig, repo_root: &Path) {
    if let Some(existing) = config_from_env(repo_root) {
        cfg.host = existing.host;
        cfg.ports = existing.ports;
        cfg.instance_name = existing.instance_name;
        cfg.instance_secret = existing.instance_secret;
        cfg.mqtt_username = existing.mqtt_username;
        cfg.mqtt_password = existing.mqtt_password;
        cfg.video_relay_secret = existing.video_relay_secret;
        cfg.mqtt_auth_relay_secret = existing.mqtt_auth_relay_secret;
        cfg.convex = existing.convex;
    }
}

/// Seed the config with any non-interactive flags the operator supplied.
pub(super) fn prefill_from_args(cfg: &mut DeployConfig, args: &Args) {
    // Reach address: an explicit --host always wins; otherwise keep a host
    // recovered from an existing deploy; otherwise default to the detected LAN IP
    // (so a browser/drone on the same network can reach it).
    if args.host.is_some() {
        cfg.host = crate::host::default_host(args.host.as_deref());
    } else if cfg.host == DeployConfig::default().host {
        cfg.host = crate::host::default_host(None);
    }
    if let Some(pw) = &args.mqtt_password {
        cfg.mqtt_password = pw.clone();
    }
    if let Some(url) = &args.convex_managed_url {
        cfg.convex = Provision::Managed { url: url.clone() };
    }
    if let Some(url) = &args.mqtt_managed_url {
        cfg.mqtt = Provision::Managed { url: url.clone() };
    }
    if let Some(url) = &args.video_managed_url {
        cfg.video = Provision::Managed { url: url.clone() };
    }
    if args.no_mqtt {
        cfg.mqtt = Provision::Managed { url: String::new() };
    }
    if args.no_video {
        cfg.video = Provision::Managed { url: String::new() };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefill_applies_flags() {
        let mut cfg = DeployConfig::with_generated_secrets();
        let args = Args {
            host: Some("10.0.0.5".into()),
            convex_managed_url: Some("https://c.example.com".into()),
            ..Args::default()
        };
        prefill_from_args(&mut cfg, &args);
        assert_eq!(cfg.host, "10.0.0.5");
        assert!(cfg.convex.is_managed());
    }
}
