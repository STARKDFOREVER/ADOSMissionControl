
/** Build an `http://<ipv4>:<port>` URL from a base URL by swapping the
 * hostname. Returns null if the input URL or the IPv4 candidate is
 * unusable. */
export function buildIpv4Fallback(baseUrl: string, ipv4: string): string | null {
  if (!ipv4 || !/^\d+\.\d+\.\d+\.\d+$/.test(ipv4)) return null;
  try {
    const u = new URL(baseUrl);
    if (u.hostname === ipv4) return null; // same address — no fallback gain
    u.hostname = ipv4;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}
