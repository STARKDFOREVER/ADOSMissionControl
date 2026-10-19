// Ground-station GNSS lane: receivers, RTK base station control, heading.

import type { GnssBase, GnssBaseBody, GnssStatus } from "./types";
import { gsRequest, type RequestContext } from "./request";

/** Receivers, base station and heading. `present:false` when no GNSS service. */
export function getGnss(ctx: RequestContext): Promise<GnssStatus> {
  return gsRequest<GnssStatus>(ctx, "/api/v1/gnss");
}

/** Switch the RTK base mode. Returns the new `base` object. */
export function setGnssBase(ctx: RequestContext, body: GnssBaseBody): Promise<GnssBase> {
  return gsRequest<GnssBase>(ctx, "/api/v1/gnss/base", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export interface GnssBaseDraft {
  mode: GnssBase["mode"];
  minDurS?: number;
  accuracyM?: number;
  latDeg?: number;
  lonDeg?: number;
  hEllipsoidM?: number;
}

const finite = (v: number | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Build the exact `PUT /api/v1/gnss/base` payload for a mode. Only the keys
 * that mode carries are sent. Returns null when the draft is incomplete or out
 * of range (survey needs a positive duration and accuracy; fixed needs a
 * finite position with |lat| <= 90 and |lon| <= 180), so a caller never sends
 * a body the agent would reject.
 */
export function gnssBaseBody(draft: GnssBaseDraft): GnssBaseBody | null {
  switch (draft.mode) {
    case "off":
      return { mode: "off" };
    case "survey":
      if (!finite(draft.minDurS) || draft.minDurS <= 0) return null;
      if (!finite(draft.accuracyM) || draft.accuracyM <= 0) return null;
      return { mode: "survey", min_dur_s: draft.minDurS, accuracy_m: draft.accuracyM };
    case "fixed":
      if (!finite(draft.latDeg) || Math.abs(draft.latDeg) > 90) return null;
      if (!finite(draft.lonDeg) || Math.abs(draft.lonDeg) > 180) return null;
      if (!finite(draft.hEllipsoidM)) return null;
      return {
        mode: "fixed",
        lat_deg: draft.latDeg,
        lon_deg: draft.lonDeg,
        h_ellipsoid_m: draft.hEllipsoidM,
      };
    default:
      return null;
  }
}
