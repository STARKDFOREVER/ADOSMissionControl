/**
 * MAVLink link-protocol slice for the persisted settings store: whether the
 * GCS manages telemetry stream rates, and whether inbound frames must carry a
 * valid signature.
 *
 * @license GPL-3.0-only
 */

import type { SettingsSliceFactory, SettingsStoreState } from "./types";

export const protocolDefaults: Partial<SettingsStoreState> = {
  gcsManagesTelemetryRates: true,
  enforceInboundSigning: false,
};

export const createProtocolActions: SettingsSliceFactory<
  Pick<SettingsStoreState, "setGcsManagesTelemetryRates" | "setEnforceInboundSigning">
> = (set) => ({
  setGcsManagesTelemetryRates: (gcsManagesTelemetryRates) => set({ gcsManagesTelemetryRates }),
  setEnforceInboundSigning: (enforceInboundSigning) => set({ enforceInboundSigning }),
});
