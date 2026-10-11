/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as changelogSync from "../changelogSync.js";
import type * as changelogSyncMutations from "../changelogSyncMutations.js";
import type * as clientConfig from "../clientConfig.js";
import type * as cmdAiUsage from "../cmdAiUsage.js";
import type * as cmdDroneAccess from "../cmdDroneAccess.js";
import type * as cmdDroneCommands from "../cmdDroneCommands.js";
import type * as cmdDroneLiveness from "../cmdDroneLiveness.js";
import type * as cmdDroneStatus from "../cmdDroneStatus.js";
import type * as cmdDrones from "../cmdDrones.js";
import type * as cmdFlightLogs from "../cmdFlightLogs.js";
import type * as cmdLogdWindows from "../cmdLogdWindows.js";
import type * as cmdMcpReach from "../cmdMcpReach.js";
import type * as cmdMcpReachDb from "../cmdMcpReachDb.js";
import type * as cmdMcpTokens from "../cmdMcpTokens.js";
import type * as cmdMqttControlGrants from "../cmdMqttControlGrants.js";
import type * as cmdPairing from "../cmdPairing.js";
import type * as cmdPluginArchives from "../cmdPluginArchives.js";
import type * as cmdPluginArchivesVerify from "../cmdPluginArchivesVerify.js";
import type * as cmdPluginCapabilityTokens from "../cmdPluginCapabilityTokens.js";
import type * as cmdPluginInstallJobs from "../cmdPluginInstallJobs.js";
import type * as cmdPlugins from "../cmdPlugins.js";
import type * as cmdPluginsValidators from "../cmdPluginsValidators.js";
import type * as cmdPreferences from "../cmdPreferences.js";
import type * as cmdSigningEvents from "../cmdSigningEvents.js";
import type * as cmdSigningKeys from "../cmdSigningKeys.js";
import type * as cmdVideoRelayTokens from "../cmdVideoRelayTokens.js";
import type * as commandVocabulary from "../commandVocabulary.js";
import type * as comments from "../comments.js";
import type * as communityChangelog from "../communityChangelog.js";
import type * as communityItems from "../communityItems.js";
import type * as contactSubmissions from "../contactSubmissions.js";
import type * as crons from "../crons.js";
import type * as discordNotify from "../discordNotify.js";
import type * as heartbeatCasing from "../heartbeatCasing.js";
import type * as http from "../http.js";
import type * as httpShared from "../httpShared.js";
import type * as lib_agentStatusPayload from "../lib/agentStatusPayload.js";
import type * as lib_capabilityTokenKeys from "../lib/capabilityTokenKeys.js";
import type * as lib_capabilityTokenSigner from "../lib/capabilityTokenSigner.js";
import type * as lib_changelogHtml from "../lib/changelogHtml.js";
import type * as lib_credentials from "../lib/credentials.js";
import type * as lib_heartbeatFields from "../lib/heartbeatFields.js";
import type * as lib_passwordPolicy from "../lib/passwordPolicy.js";
import type * as lib_pluginManifestClaims from "../lib/pluginManifestClaims.js";
import type * as lib_pluginRecordsIngest from "../lib/pluginRecordsIngest.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_videoRelayToken from "../lib/videoRelayToken.js";
import type * as mosquittoPasswd from "../mosquittoPasswd.js";
import type * as operatorHmacSecrets from "../operatorHmacSecrets.js";
import type * as paramRegistry from "../paramRegistry.js";
import type * as pluginRecords from "../pluginRecords.js";
import type * as pluginRegistry from "../pluginRegistry.js";
import type * as profiles from "../profiles.js";
import type * as schemaDroneStatusCore from "../schemaDroneStatusCore.js";
import type * as schemaDroneStatusSurfaces from "../schemaDroneStatusSurfaces.js";
import type * as schemaTables from "../schemaTables.js";
import type * as schemaTablesCommunity from "../schemaTablesCommunity.js";
import type * as schemaTablesDrones from "../schemaTablesDrones.js";
import type * as schemaTablesFlight from "../schemaTablesFlight.js";
import type * as schemaTablesPlugins from "../schemaTablesPlugins.js";
import type * as storage from "../storage.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  changelogSync: typeof changelogSync;
  changelogSyncMutations: typeof changelogSyncMutations;
  clientConfig: typeof clientConfig;
  cmdAiUsage: typeof cmdAiUsage;
  cmdDroneAccess: typeof cmdDroneAccess;
  cmdDroneCommands: typeof cmdDroneCommands;
  cmdDroneLiveness: typeof cmdDroneLiveness;
  cmdDroneStatus: typeof cmdDroneStatus;
  cmdDrones: typeof cmdDrones;
  cmdFlightLogs: typeof cmdFlightLogs;
  cmdLogdWindows: typeof cmdLogdWindows;
  cmdMcpReach: typeof cmdMcpReach;
  cmdMcpReachDb: typeof cmdMcpReachDb;
  cmdMcpTokens: typeof cmdMcpTokens;
  cmdMqttControlGrants: typeof cmdMqttControlGrants;
  cmdPairing: typeof cmdPairing;
  cmdPluginArchives: typeof cmdPluginArchives;
  cmdPluginArchivesVerify: typeof cmdPluginArchivesVerify;
  cmdPluginCapabilityTokens: typeof cmdPluginCapabilityTokens;
  cmdPluginInstallJobs: typeof cmdPluginInstallJobs;
  cmdPlugins: typeof cmdPlugins;
  cmdPluginsValidators: typeof cmdPluginsValidators;
  cmdPreferences: typeof cmdPreferences;
  cmdSigningEvents: typeof cmdSigningEvents;
  cmdSigningKeys: typeof cmdSigningKeys;
  cmdVideoRelayTokens: typeof cmdVideoRelayTokens;
  commandVocabulary: typeof commandVocabulary;
  comments: typeof comments;
  communityChangelog: typeof communityChangelog;
  communityItems: typeof communityItems;
  contactSubmissions: typeof contactSubmissions;
  crons: typeof crons;
  discordNotify: typeof discordNotify;
  heartbeatCasing: typeof heartbeatCasing;
  http: typeof http;
  httpShared: typeof httpShared;
  "lib/agentStatusPayload": typeof lib_agentStatusPayload;
  "lib/capabilityTokenKeys": typeof lib_capabilityTokenKeys;
  "lib/capabilityTokenSigner": typeof lib_capabilityTokenSigner;
  "lib/changelogHtml": typeof lib_changelogHtml;
  "lib/credentials": typeof lib_credentials;
  "lib/heartbeatFields": typeof lib_heartbeatFields;
  "lib/passwordPolicy": typeof lib_passwordPolicy;
  "lib/pluginManifestClaims": typeof lib_pluginManifestClaims;
  "lib/pluginRecordsIngest": typeof lib_pluginRecordsIngest;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/videoRelayToken": typeof lib_videoRelayToken;
  mosquittoPasswd: typeof mosquittoPasswd;
  operatorHmacSecrets: typeof operatorHmacSecrets;
  paramRegistry: typeof paramRegistry;
  pluginRecords: typeof pluginRecords;
  pluginRegistry: typeof pluginRegistry;
  profiles: typeof profiles;
  schemaDroneStatusCore: typeof schemaDroneStatusCore;
  schemaDroneStatusSurfaces: typeof schemaDroneStatusSurfaces;
  schemaTables: typeof schemaTables;
  schemaTablesCommunity: typeof schemaTablesCommunity;
  schemaTablesDrones: typeof schemaTablesDrones;
  schemaTablesFlight: typeof schemaTablesFlight;
  schemaTablesPlugins: typeof schemaTablesPlugins;
  storage: typeof storage;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
