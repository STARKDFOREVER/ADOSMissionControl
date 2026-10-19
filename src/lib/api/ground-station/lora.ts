// Ground-station LoRa lane: status + duty governor, region table, beacons.

import type {
  LoraBeaconsResponse,
  LoraRegionsResponse,
  LoraStatus,
  LoraUpdate,
} from "./types";
import { gsRequest, type RequestContext } from "./request";

/** Lane status and governor. `present:false` when no LoRa service. */
export function getLora(ctx: RequestContext): Promise<LoraStatus> {
  return gsRequest<LoraStatus>(ctx, "/api/v1/lora");
}

/** The compiled region table, for the region picker. */
export function getLoraRegions(ctx: RequestContext): Promise<LoraRegionsResponse> {
  return gsRequest<LoraRegionsResponse>(ctx, "/api/v1/lora/regions");
}

/** Change the region (`null` follows the country setting) and/or channel
 * parameters. Out-of-plan values answer 400 `E_LORA_OUT_OF_PLAN`; a region
 * change while armed answers 409 `E_ARMED` (thrown as `AgentArmedRefusal`).
 * Returns the full GET body. */
export function setLora(ctx: RequestContext, body: LoraUpdate): Promise<LoraStatus> {
  return gsRequest<LoraStatus>(ctx, "/api/v1/lora", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** Position beacons heard, newest first (the agent caps the list at 100). */
export function getLoraBeacons(ctx: RequestContext): Promise<LoraBeaconsResponse> {
  return gsRequest<LoraBeaconsResponse>(ctx, "/api/v1/lora/beacons");
}
