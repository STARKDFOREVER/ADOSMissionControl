/**
 * @module PluginClientArchive
 * @description Archive parse and install calls of the plugin client.
 * @license GPL-3.0-only
 */

import { withPluginArmedRetry } from "../plugin-lifecycle";
import { contentDigestHeader } from "../upload-digest";
import type { PluginAgentInstallSummary, PluginAgentParseSummary } from "../plugin-client-types";
import { PLUGIN_TRANSFER_TIMEOUT_MS, parsePluginResponse, type AgentFetch } from "./errors";

/** What an archive call needs from the client. */
export interface PluginArchiveRequest {
  baseUrl: string;
  authHeader: Record<string, string>;
  fetchImpl: AgentFetch;
}

/** Validate the archive without committing the install. */
export async function parsePluginArchive(
  req: PluginArchiveRequest,
  file: File,
): Promise<PluginAgentParseSummary> {
  const form = new FormData();
  form.append("file", file);
  const res = await req.fetchImpl(
    `${req.baseUrl}/api/plugins/parse`,
    {
      method: "POST",
      headers: { ...req.authHeader, ...(await contentDigestHeader(file)) },
      body: form,
    },
    PLUGIN_TRANSFER_TIMEOUT_MS,
  );
  return parsePluginResponse<PluginAgentParseSummary>(res);
}

/** Install an archive, retrying once with the armed override on consent. */
export async function installPluginArchive(
  req: PluginArchiveRequest,
  file: File,
): Promise<PluginAgentInstallSummary> {
  const digest = await contentDigestHeader(file);
  return withPluginArmedRetry(async (force) => {
    const form = new FormData();
    form.append("file", file);
    // Multipart carries no JSON body, so the override rides the query.
    const res = await req.fetchImpl(
      `${req.baseUrl}/api/plugins/install${force ? "?force=1" : ""}`,
      { method: "POST", headers: { ...req.authHeader, ...digest }, body: form },
      PLUGIN_TRANSFER_TIMEOUT_MS,
    );
    return parsePluginResponse<PluginAgentInstallSummary>(res);
  });
}

/** Have the agent fetch and signature-check an archive from a URL without
 * installing it. */
export async function parsePluginFromUrl(
  req: PluginArchiveRequest,
  url: string,
  expectedSha256: string,
): Promise<PluginAgentParseSummary> {
  const res = await req.fetchImpl(
    `${req.baseUrl}/api/plugins/parse_from_url`,
    {
      method: "POST",
      headers: { ...req.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        ...(expectedSha256 ? { expected_sha256: expectedSha256 } : {}),
      }),
    },
    PLUGIN_TRANSFER_TIMEOUT_MS,
  );
  return parsePluginResponse<PluginAgentParseSummary>(res);
}
