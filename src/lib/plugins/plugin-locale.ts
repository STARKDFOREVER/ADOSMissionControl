"use client";

/**
 * @module plugins/plugin-locale
 * @description A plugin's own string bundle (`locales/<lang>.json` in its
 * archive), read from the node's agent so native surfaces that render a
 * plugin's declarative strings (parameter group headings) show the plugin's
 * words, not its raw keys. One read per node, plugin and language: concurrent
 * and later callers share it, so many mounted panels never burst the agent's
 * per-caller rate limit.
 *
 * @license GPL-3.0-only
 */

import {
  pluginClientForReach,
  type NodeAgentReach,
} from "@/lib/plugins/node-agent-reach";

export type PluginLocaleBundle = Readonly<Record<string, string>>;

/** The language every plugin bundle falls back to. */
const FALLBACK_LANG = "en";

const reads = new Map<string, Promise<PluginLocaleBundle>>();

/**
 * The plugin's bundle for `lang`, else its `en` bundle, else empty. A failed
 * read resolves empty and is not cached, so the next mount retries it.
 */
export function loadPluginLocale(
  reach: NodeAgentReach,
  pluginId: string,
  lang: string,
): Promise<PluginLocaleBundle> {
  const key = `${reach.hostUrl}|${reach.peerDeviceId ?? ""}|${pluginId}|${lang}`;
  const cached = reads.get(key);
  if (cached) return cached;
  const client = pluginClientForReach(reach);
  const read = (async (): Promise<PluginLocaleBundle> => {
    const own = await client.getLocale(pluginId, lang);
    if (own || lang === FALLBACK_LANG) return own ?? {};
    return (await client.getLocale(pluginId, FALLBACK_LANG)) ?? {};
  })().catch((): PluginLocaleBundle => {
    reads.delete(key);
    return {};
  });
  reads.set(key, read);
  return read;
}

/** Test seam: forget every cached read. */
export function resetPluginLocaleCache(): void {
  reads.clear();
}
