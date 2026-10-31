#![allow(clippy::field_reassign_with_default)]

use super::*;

#[test]
fn default_urls_use_host_and_ports() {
    let mut c = DeployConfig::default();
    c.host = "192.168.1.50".to_string();
    assert_eq!(c.next_public_convex_url(), "http://192.168.1.50:3210");
    assert_eq!(c.convex_site_url(), "http://192.168.1.50:3211");
    assert_eq!(c.site_url(), "http://192.168.1.50:4000");
    assert_eq!(c.dashboard_url(), "http://192.168.1.50:6791");
    assert_eq!(c.mqtt_broker_url(), "ws://192.168.1.50:9001/mqtt");
    assert_eq!(c.video_relay_url(), "ws://192.168.1.50:3001");
}

#[test]
fn https_posture_switches_browser_schemes() {
    let mut c = DeployConfig::default();
    c.host = "fleet.example.com".to_string();
    c.tls = Tls::CustomProxy;
    assert_eq!(c.next_public_convex_url(), "https://fleet.example.com:3210");
    assert_eq!(c.mqtt_broker_url(), "wss://fleet.example.com:9001/mqtt");
}

#[test]
fn managed_services_drop_their_containers_and_use_supplied_urls() {
    let mut c = DeployConfig::default();
    c.host = "10.0.0.9".to_string();
    c.mqtt = Provision::Managed {
        url: "wss://mqtt.example.com/mqtt".to_string(),
    };
    c.video = Provision::Managed {
        url: "wss://video.example.com".to_string(),
    };
    assert_eq!(c.mqtt_broker_url(), "wss://mqtt.example.com/mqtt");
    assert_eq!(c.video_relay_url(), "wss://video.example.com");
    let svc = c.compose_services();
    assert!(svc.contains(&"convex-backend"));
    assert!(svc.contains(&"mission-control"));
    assert!(!svc.contains(&"mosquitto"));
    assert!(!svc.contains(&"video-relay"));
}

#[test]
fn relay_only_scope_drops_convex_and_gcs() {
    let mut c = DeployConfig::default();
    c.scope = Scope::RelayOnly;
    let svc = c.compose_services();
    assert!(!svc.contains(&"convex-backend"));
    assert!(!svc.contains(&"mission-control"));
    assert!(svc.contains(&"mosquitto"));
    assert!(svc.contains(&"video-relay"));
}

#[test]
fn generated_secrets_are_hex_of_expected_length() {
    let c = DeployConfig::with_generated_secrets();
    assert_eq!(c.instance_secret.len(), 64); // 32 bytes → 64 hex chars
    assert_eq!(c.mqtt_password.len(), 36); // 18 bytes → 36 hex chars
    assert!(c.instance_secret.chars().all(|ch| ch.is_ascii_hexdigit()));
}

#[test]
fn compose_services_matrix() {
    use crate::services::*;
    // All-in-one, everything spun up → all six containers.
    let all = DeployConfig::default().compose_services();
    for svc in [
        SVC_CONVEX_BACKEND,
        SVC_CONVEX_DASHBOARD,
        SVC_MISSION_CONTROL,
        SVC_MOSQUITTO,
        SVC_MQTT_AUTH_SYNC,
        SVC_VIDEO_RELAY,
    ] {
        assert!(all.contains(&svc), "all-in-one is missing {svc}");
    }

    // --no-mqtt + --no-video (Managed with an empty URL) drop those containers
    // but keep Convex + the GCS.
    let mut c = DeployConfig::default();
    c.mqtt = Provision::Managed { url: String::new() };
    c.video = Provision::Managed { url: String::new() };
    let s = c.compose_services();
    assert!(s.contains(&SVC_CONVEX_BACKEND));
    assert!(s.contains(&SVC_MISSION_CONTROL));
    assert!(!s.contains(&SVC_MOSQUITTO));
    assert!(!s.contains(&SVC_MQTT_AUTH_SYNC));
    assert!(!s.contains(&SVC_VIDEO_RELAY));

    // GCS unchecked drops just the mission-control container.
    let mut c2 = DeployConfig::default();
    c2.gcs = false;
    assert!(!c2.compose_services().contains(&SVC_MISSION_CONTROL));
}
