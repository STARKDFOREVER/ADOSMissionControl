/**
 * @module video/webrtc/whep-auth
 * @description The node API key a WHEP request presents. The agent's `:8080`
 * front authenticates `/whep` like every other data-plane route, so a paired
 * node answers an offer (and a session DELETE) without `X-ADOS-Key` with 401.
 * Every WHEP caller (the shared cascade session, the fleet tiles, the PiP
 * inset, the camera thumbnails) resolves its key here, so the rule for when a
 * key may travel lives in one place.
 * @license GPL-3.0-only
 */

/**
 * The node API key to present on `whepUrl`, or null. The key is sent only
 * when the WHEP endpoint is on the node's own origin (`agentUrl`): it
 * authorizes that node's front and must never travel to any other host (a
 * manual SITL/Gazebo override, or an absolute URL an older agent advertised).
 */
export function whepKeyFor(
  whepUrl: string | null | undefined,
  agentUrl: string | null | undefined,
  apiKey: string | null | undefined,
): string | null {
  if (!whepUrl || !agentUrl || !apiKey) return null;
  try {
    return new URL(whepUrl).origin === new URL(agentUrl).origin ? apiKey : null;
  } catch {
    return null;
  }
}

/** The auth header for a WHEP POST or DELETE; empty when there is no key. */
export function whepAuthHeaders(apiKey: string | null | undefined): Record<string, string> {
  return apiKey ? { "X-ADOS-Key": apiKey } : {};
}
