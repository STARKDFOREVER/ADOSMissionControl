/**
 * @module schemaTables
 * @description Every table the shared Convex functions read or write.
 *
 * `schema.ts` in each deployment is `defineSchema` over these tables plus that
 * deployment's own. A deployment that widens a shared table (extra columns or
 * roles) rebuilds it from the field objects exported by
 * `schemaTablesCommunity.ts` under the same name, after spreading these.
 *
 * @license GPL-3.0-only
 */

import { authTables } from "@convex-dev/auth/server";
import { communityTables } from "./schemaTablesCommunity";
import { droneTables } from "./schemaTablesDrones";
import { flightTables } from "./schemaTablesFlight";
import { pluginTables } from "./schemaTablesPlugins";

export function sharedTables() {
  return {
    ...authTables,
    ...communityTables,
    ...flightTables,
    ...droneTables,
    ...pluginTables,
  };
}
