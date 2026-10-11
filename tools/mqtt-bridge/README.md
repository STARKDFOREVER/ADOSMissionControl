# MQTT broker assets

Deployment assets for the ADOS cloud relay broker: a Mosquitto config, its
ACL policy, the auth-sync image and scripts that regenerate the broker's
passwd and ACL from Convex, and a reference Docker Compose file. There is no
forwarder service here.

## How data flows

```
Drone Agent --HTTPS--> Convex /agent/status        (heartbeat and status)
Drone Agent --MQTT---> Mosquitto <--WSS-- GCS      (relay planes only)
                          |
              cloudflared tunnel (mqtt.your-domain.com:9001 WebSocket)
```

The agent posts its status to Convex over HTTPS at `/agent/status`. MQTT
carries only the relay planes between the agent and a browser GCS: MAVLink
and MSP frames, WebRTC signaling, plugin streams and plugin update notices.

## Layout

| Path | Purpose |
|------|---------|
| `deploy/mosquitto.conf` | Broker config (production auth on, bench block at the bottom) |
| `deploy/acl.conf` | ACL policy seed; per-device entries are generated |
| `deploy/auth-sync.Dockerfile` | Image that runs the auth-sync loop |
| `deploy/scripts/` | `regenerate-passwd.sh`, `auth-sync-loop.sh`, `activate-auth.sh`, `deactivate-auth.sh` |
| `deploy/docker-compose.yml` | Reference broker plus Cloudflare Tunnel stack |
| `deploy/README.md` | Production runbook: auth model, one-time setup, regen timer |

## Deploy with Docker Compose

```bash
cd deploy
cp .env.example .env
# Edit .env with your values

docker compose up -d
```

On first run, create the Mosquitto password file with the `ados` service
account (see `deploy/README.md` for per-device entries):

```bash
docker exec -it deploy-mosquitto-1 mosquitto_passwd -c /mosquitto/config/passwd ados
docker compose restart mosquitto
```

## Cloudflare Tunnel

The `cloudflared` service exposes Mosquitto's WebSocket listener (port 9001) as `mqtt.your-domain.com`. Configure the tunnel in your Cloudflare Zero Trust dashboard:

1. Create a tunnel and copy the token
2. Set `CLOUDFLARE_TUNNEL_TOKEN` in `.env`
3. Add a public hostname route: `mqtt.your-domain.com` -> `ws://mosquitto:9001`

Browser MQTT clients (like the GCS) connect via `wss://mqtt.your-domain.com`.

## Topics

Published and subscribed by the agent's cloud relay (`ados-cloud` crate):

| Topic | QoS | Direction |
|-------|-----|-----------|
| `ados/{deviceId}/mavlink/tx` | 0 | Agent publishes FC to GCS frames |
| `ados/{deviceId}/mavlink/rx` | 0 | GCS publishes GCS to FC frames |
| `ados/{deviceId}/msp/tx` | 0 | Agent publishes MSP bytes |
| `ados/{deviceId}/msp/rx` | 0 | GCS publishes MSP bytes |
| `ados/{deviceId}/webrtc/offer` | 1 | GCS publishes SDP offers and session closes |
| `ados/{deviceId}/webrtc/answer/{sessionId}` | 1 | Agent publishes the SDP answer for one session |
| `ados/{deviceId}/vision/detections` | 0 | Agent publishes vision detection batches |
| `ados/{deviceId}/plugin/update_available` | 1 | Agent publishes plugin update notices |
| `ados/{deviceId}/plugin/{pluginId}/{stream}` | 0 | Agent publishes a plugin's live stream |

## License

GPL-3.0-only. See [LICENSE](LICENSE).
