/**
 * @module lib/fleetCardFields
 * @description Values `pushStatus` denormalises onto `cmd_drones` for the
 * fleet card, derived from the heartbeat payload alone so a source that
 * vanishes clears its pill instead of leaving the last value standing.
 * @license GPL-3.0-only
 */

/**
 * The attached display type from `peripherals[]`: the agent reports the SPI
 * LCD as an entry with `category: "display"`, so the fleet card can render an
 * "LCD" badge without re-querying the full status row. `peripherals` is a
 * `v.any()` passthrough, so each entry is narrowed rather than asserted: a
 * manifest that renames either key reads as "no display", never a made-up one.
 */
export function attachedDisplayType(peripherals: unknown): string | undefined {
  if (!Array.isArray(peripherals)) return undefined;
  for (const entry of peripherals as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    if (!("category" in entry) || entry.category !== "display") continue;
    return "type" in entry && typeof entry.type === "string"
      ? entry.type
      : undefined;
  }
  return undefined;
}

/** The direct LAN MAVLink URL, so the fleet card can render a "Direct" pill
 * without joining `cmd_droneStatus` on every render. */
export function manualMavlinkWsUrl(
  manualConnectionUrls: unknown,
): string | undefined {
  if (!manualConnectionUrls || typeof manualConnectionUrls !== "object")
    return undefined;
  if (!("mavlinkWs" in manualConnectionUrls)) return undefined;
  const ws = manualConnectionUrls.mavlinkWs;
  return typeof ws === "string" && ws.length > 0 ? ws : undefined;
}
