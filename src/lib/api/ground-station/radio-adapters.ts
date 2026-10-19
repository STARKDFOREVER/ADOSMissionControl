// Multi-adapter WFB radio view: the per-adapter REST read, the forward-
// permissive adapter normalizer shared with the capability radio block, and
// the receive-diversity summary.

import type {
  RadioAdapter,
  RadioAdapterRole,
  RadioAdaptersResponse,
  RadioDiversity,
} from "./types";
import { gsRequest, type RequestContext } from "./request";

const ADAPTER_ROLES: Record<RadioAdapterRole, true> = {
  rxtx: true,
  rx: true,
  tx: true,
  mesh: true,
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/**
 * Normalize an on-wire `adapters[]` array. Reads the snake_case wire keys and
 * accepts camelCase as a fallback. An entry without an interface name is
 * dropped; an unknown role is null; unmeasured counters stay null.
 */
export function normalizeRadioAdapters(raw: unknown): RadioAdapter[] {
  if (!Array.isArray(raw)) return [];
  const out: RadioAdapter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const iface = str(a.iface);
    if (!iface) continue;
    const roleRaw = a.role;
    const rssiRaw = a.rssi_dbm ?? a.rssiDbm;
    out.push({
      iface,
      mac: str(a.mac),
      usb_path: str(a.usb_path ?? a.usbPath),
      driver: str(a.driver),
      role:
        typeof roleRaw === "string" && Object.hasOwn(ADAPTER_ROLES, roleRaw)
          ? (roleRaw as RadioAdapterRole)
          : null,
      antenna: str(a.antenna),
      tx_active: bool(a.tx_active ?? a.txActive),
      rssi_dbm: Array.isArray(rssiRaw)
        ? rssiRaw.filter((v): v is number => num(v) !== null)
        : [],
      packets: num(a.packets),
      lost: num(a.lost),
      fec_rec: num(a.fec_rec ?? a.fecRec),
      verified: bool(a.verified),
    });
  }
  return out;
}

function normalizeDiversity(raw: unknown): RadioDiversity | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  return {
    rx_adapters: num(d.rx_adapters) ?? 0,
    combined_loss_pct: num(d.combined_loss_pct),
    best_single_loss_pct: num(d.best_single_loss_pct),
  };
}

/** Per-adapter radio view. */
export async function getRadioAdapters(ctx: RequestContext): Promise<RadioAdaptersResponse> {
  const raw = await gsRequest<Record<string, unknown>>(ctx, "/api/v1/radio/adapters");
  return {
    // Only an explicit `false` reads absent; an agent that predates the field
    // serves adapters only when it has them.
    present: raw?.present !== false,
    adapters: normalizeRadioAdapters(raw?.adapters),
    diversity: normalizeDiversity(raw?.diversity),
  };
}

/** Loss percentage for one adapter: lost / (received + lost). Null when the
 * adapter has seen no traffic. */
export function adapterLossPct(a: RadioAdapter): number | null {
  if (a.packets === null || a.lost === null) return null;
  const total = a.packets + a.lost;
  return total > 0 ? (a.lost / total) * 100 : null;
}

export interface DiversitySummary {
  /** Adapters that receive (role rx or rxtx). */
  rxAdapters: number;
  /** Loss of the combined (deduplicated) stream. */
  combinedLossPct: number | null;
  /** Lowest loss of any single receive adapter. */
  bestSingleLossPct: number | null;
  /** best single / combined; how much diversity improves on the best
   * adapter alone. Null unless combined loss is above zero. */
  gainRatio: number | null;
}

/**
 * Receive-diversity summary. The agent's own verdict (`reported`) wins field
 * by field; otherwise the receive-adapter count and best single-adapter loss
 * are derived from the adapters, and `combinedFallbackPct` (the link's
 * overall loss after combining) stands in for the combined figure.
 */
export function diversitySummary(
  adapters: readonly RadioAdapter[],
  reported: RadioDiversity | null = null,
  combinedFallbackPct: number | null = null,
): DiversitySummary {
  const rx = adapters.filter((a) => a.role === "rx" || a.role === "rxtx");
  let derivedBest: number | null = null;
  for (const a of rx) {
    const loss = adapterLossPct(a);
    if (loss !== null && (derivedBest === null || loss < derivedBest)) derivedBest = loss;
  }
  const combined = reported?.combined_loss_pct ?? combinedFallbackPct;
  const best = reported?.best_single_loss_pct ?? derivedBest;
  return {
    rxAdapters: reported?.rx_adapters ?? rx.length,
    combinedLossPct: combined,
    bestSingleLossPct: best,
    gainRatio: combined !== null && combined > 0 && best !== null ? best / combined : null,
  };
}
