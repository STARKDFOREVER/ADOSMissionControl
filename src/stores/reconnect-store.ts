/**
 * @module reconnect-store
 * @description The live auto-reconnect cycles, as the UI and the drone manager
 * see them. Wraps the `ReconnectManager` the auto-reconnect hook owns, so a
 * cycle can be stopped from the toast, the fleet list, an operator disconnect,
 * or a manual connect that reaches the same endpoint.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { ConnectionMeta } from "@/lib/connection-meta";
import type { ReconnectEntry, ReconnectState } from "@/lib/reconnect-manager";

/** One drone being re-dialled. */
export interface ReconnectRecord {
  droneId: string;
  droneName: string;
  endpoint: ConnectionMeta;
  attempts: number;
  startedAt: number;
  state: ReconnectState;
}

/** The part of `ReconnectManager` the store drives. */
export interface ReconnectController {
  cancelReconnect(droneId: string): void;
  onStateChange(listener: (entry: ReconnectEntry) => void): () => void;
}

interface ReconnectStoreState {
  entries: Map<string, ReconnectRecord>;
  /** Mirror a manager's cycles. Returns an unbind that forgets them. */
  bind: (manager: ReconnectController) => () => void;
  /** Stop re-dialling one drone. */
  cancel: (droneId: string) => void;
  /**
   * Stop every cycle whose endpoint is the one `meta` reaches, except the
   * cycle for `exceptId` (a cycle landing its own reconnect). Returns the ids
   * cancelled.
   */
  cancelMatching: (meta: ConnectionMeta, exceptId?: string) => string[];
  /** Stop every cycle. */
  cancelAll: () => void;
}

/**
 * Whether two links reach the same endpoint: the same URL, the same USB
 * serial adapter (VID:PID), or the same UDP/TCP proto, host and port.
 */
export function sameEndpoint(a: ConnectionMeta, b: ConnectionMeta): boolean {
  if (a.url !== undefined && a.url === b.url) return true;
  if (
    a.type === "serial" &&
    b.type === "serial" &&
    a.portVendorId !== undefined &&
    a.portProductId !== undefined &&
    a.portVendorId === b.portVendorId &&
    a.portProductId === b.portProductId
  ) {
    return true;
  }
  return (
    a.proto !== undefined &&
    a.host !== undefined &&
    a.port !== undefined &&
    a.proto === b.proto &&
    a.host === b.host &&
    a.port === b.port
  );
}

let controller: ReconnectController | null = null;

export const useReconnectStore = create<ReconnectStoreState>((set, get) => {
  const drop = (droneId: string) => {
    if (!get().entries.has(droneId)) return;
    const next = new Map(get().entries);
    next.delete(droneId);
    set({ entries: next });
  };

  return {
    entries: new Map(),

    bind: (manager) => {
      controller = manager;
      const unsubscribe = manager.onStateChange((entry) => {
        if (entry.state === "connected") {
          drop(entry.droneId);
          return;
        }
        const next = new Map(get().entries);
        next.set(entry.droneId, {
          droneId: entry.droneId,
          droneName: entry.droneName,
          endpoint: entry.meta,
          attempts: entry.attempt,
          startedAt: entry.startedAt,
          state: entry.state,
        });
        set({ entries: next });
      });
      return () => {
        unsubscribe();
        if (controller === manager) controller = null;
        set({ entries: new Map() });
      };
    },

    cancel: (droneId) => {
      controller?.cancelReconnect(droneId);
      drop(droneId);
    },

    cancelMatching: (meta, exceptId) => {
      const ids = [...get().entries.values()]
        .filter((r) => r.droneId !== exceptId && sameEndpoint(r.endpoint, meta))
        .map((r) => r.droneId);
      for (const id of ids) get().cancel(id);
      return ids;
    },

    cancelAll: () => {
      for (const id of [...get().entries.keys()]) get().cancel(id);
    },
  };
});
