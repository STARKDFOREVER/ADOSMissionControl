"use client";

/**
 * @module ground-station/use-radio-adapters
 * @description Polls `GET /api/v1/radio/adapters` for one node. An agent that
 * answers 404 predates the route: polling stops for that agent (no request
 * every tick against a route it will never serve) and resumes only when the
 * node's agent URL or key changes. Each answer is tagged with the origin it
 * came from, so a late answer for another node is never returned.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import {
  GroundStationApiError,
  type RadioAdaptersResponse,
} from "@/lib/api/ground-station-api";
import { useGroundStationPoll } from "./use-gs-poll";

const ADAPTERS_POLL_MS = 2000;

/** The origin a client built from `agentUrl` targets (trailing slashes off). */
const originOf = (agentUrl: string) => agentUrl.replace(/\/+$/, "");

export function useRadioAdapters(
  agentUrl: string | null,
  apiKey: string | null,
): RadioAdaptersResponse | null {
  const [read, setRead] = useState<{ from: string; data: RadioAdaptersResponse } | null>(null);
  // `${origin}|${apiKey}` of an agent that answered 404.
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const key = agentUrl ? `${originOf(agentUrl)}|${apiKey ?? ""}` : null;
  const stopped = key !== null && unsupported === key;

  useGroundStationPoll(stopped ? null : agentUrl, apiKey, ADAPTERS_POLL_MS, async (api) => {
    try {
      const data = await api.getRadioAdapters();
      setRead({ from: api.baseUrl, data });
    } catch (err) {
      if (err instanceof GroundStationApiError && err.status === 404) {
        setUnsupported(`${api.baseUrl}|${apiKey ?? ""}`);
      }
      throw err;
    }
  });

  return read !== null && agentUrl !== null && read.from === originOf(agentUrl) ? read.data : null;
}
