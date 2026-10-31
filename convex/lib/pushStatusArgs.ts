/**
 * @module convex/lib/pushStatusArgs
 * @description The `pushStatus` heartbeat validator args, assembled from the
 * per-area declarations.
 *
 * @license GPL-3.0-only
 */

import { systemStatusArgs } from "./pushStatusArgsSystem";
import { linkStatusArgs } from "./pushStatusArgsLink";
import { radioStatusArgs } from "./pushStatusArgsRadio";
import { nodeStatusArgs } from "./pushStatusArgsNode";

/**
 * Every top-level key the cloud heartbeat may carry.
 *
 * Declared as a named object rather than inline on the mutation so the key set
 * has ONE definition. The `/agent/status` route in `convex/http.ts` picks the
 * fields it forwards one at a time, and the parity gate asserts that every key
 * declared here is picked there -- a validator added without a matching pick is
 * a column this deployment can never fill, however the agent emits it. The
 * hosted superset deployment reads the same object to filter its incoming body,
 * because an undeclared key rejects the WHOLE call and takes the node dark.
 */
export const pushStatusArgs = {
  ...systemStatusArgs,
  ...linkStatusArgs,
  ...radioStatusArgs,
  ...nodeStatusArgs,
};
