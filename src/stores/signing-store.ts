/**
 * Per-drone MAVLink signing state.
 *
 * Authoritative state lives in two places:
 *   - Capability: polled from the agent.
 *   - Browser key presence, keyId, enrolled_at, enrollment state:
 *     read from the IndexedDB keystore (`signing-keystore.ts`).
 *
 * This store is the React-facing aggregation of both.
 *
 * @module stores/signing-store
 */

import { create } from "zustand";
import type { SigningCapability } from "@/lib/agent/client";

export type EnrollmentUIState =
  | "unknown"                // not yet checked
  | "no_browser_key"         // FC may be enrolled or not; this browser has no key
  | "pending_fc_online"      // browser has a key, waiting for drone to come online to enroll FC
  | "enrolled"               // browser key matches FC, signed frames flowing
  | "fc_rejected"            // FC rejected our key (key mismatch, manual intervention needed)
  | "unconfirmed"            // a new key may or may not be on the FC; the previous key is kept
  | "disable_unconfirmed";   // a disable was sent, unacknowledged; the key is kept

export interface DroneSigningState {
  droneId: string;
  capability: SigningCapability | null;
  capabilityPolledAt: number | null;
  keyId: string | null;
  enrolledAt: string | null;
  /** Fingerprint of the key kept alongside an "unconfirmed" new key. */
  previousKeyId: string | null;
  hasBrowserKey: boolean;
  enrollmentState: EnrollmentUIState;
}

/**
 * Inbound signature counters for one MAVLink link. `signedOk` / `signedBad`
 * count only while a signing key is loaded (no key, nothing to verify with);
 * `unsigned` counts every frame that arrived without a signature.
 */
export interface LinkSigningCounters {
  signedOk: number;
  signedBad: number;
  unsigned: number;
}

interface SigningStoreState {
  // Per-drone state keyed by droneId.
  drones: Record<string, DroneSigningState>;
  /** Per-link inbound verification counters, keyed by the protocol's link id. */
  linkCounters: Record<string, LinkSigningCounters>;

  // Selectors.
  get(droneId: string): DroneSigningState;

  // Mutations.
  setCapability(droneId: string, capability: SigningCapability): void;
  setBrowserKey(
    droneId: string,
    opts: {
      keyId: string;
      enrolledAt: string;
      enrollmentState: EnrollmentUIState;
      previousKeyId?: string | null;
    } | null,
  ): void;
  setEnrollmentState(droneId: string, state: EnrollmentUIState): void;
  /** Replace one link's counters (the adapter flushes them at most once a second). */
  setLinkCounters(linkId: string, counters: LinkSigningCounters): void;
  /** Drop a closed link's counters. */
  clearLink(linkId: string): void;

  /** Drop every record. Used on sign-out / user-switch purge pairs. */
  clearAll(): void;
  /** Drop a single drone. */
  clearDrone(droneId: string): void;
}

function blankState(droneId: string): DroneSigningState {
  return {
    droneId,
    capability: null,
    capabilityPolledAt: null,
    keyId: null,
    enrolledAt: null,
    previousKeyId: null,
    hasBrowserKey: false,
    enrollmentState: "unknown",
  };
}

export const useSigningStore = create<SigningStoreState>()((set, get) => ({
  drones: {},
  linkCounters: {},

  get(droneId) {
    return get().drones[droneId] ?? blankState(droneId);
  },

  setCapability(droneId, capability) {
    set((s) => ({
      drones: {
        ...s.drones,
        [droneId]: {
          ...(s.drones[droneId] ?? blankState(droneId)),
          capability,
          capabilityPolledAt: Date.now(),
        },
      },
    }));
  },

  setBrowserKey(droneId, opts) {
    set((s) => {
      const prev = s.drones[droneId] ?? blankState(droneId);
      if (opts === null) {
        return {
          drones: {
            ...s.drones,
            [droneId]: {
              ...prev,
              keyId: null,
              enrolledAt: null,
              previousKeyId: null,
              hasBrowserKey: false,
              enrollmentState: "no_browser_key",
            },
          },
        };
      }
      return {
        drones: {
          ...s.drones,
          [droneId]: {
            ...prev,
            keyId: opts.keyId,
            enrolledAt: opts.enrolledAt,
            previousKeyId: opts.previousKeyId ?? null,
            hasBrowserKey: true,
            enrollmentState: opts.enrollmentState,
          },
        },
      };
    });
  },

  setEnrollmentState(droneId, state) {
    set((s) => ({
      drones: {
        ...s.drones,
        [droneId]: {
          ...(s.drones[droneId] ?? blankState(droneId)),
          enrollmentState: state,
        },
      },
    }));
  },

  setLinkCounters(linkId, counters) {
    set((s) => ({ linkCounters: { ...s.linkCounters, [linkId]: counters } }));
  },

  clearLink(linkId) {
    set((s) => {
      if (!(linkId in s.linkCounters)) return s;
      const next = { ...s.linkCounters };
      delete next[linkId];
      return { linkCounters: next };
    });
  },

  clearAll() {
    set({ drones: {}, linkCounters: {} });
  },

  clearDrone(droneId) {
    set((s) => {
      const next = { ...s.drones };
      delete next[droneId];
      return { drones: next };
    });
  },
}));
