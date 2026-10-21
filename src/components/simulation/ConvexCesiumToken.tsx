/**
 * @module ConvexCesiumToken
 * @description Fetches the Cesium Ion token from Convex `clientConfig` and
 * reports it to the parent. Renders nothing. Mount only when Convex is
 * available.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect } from "react";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { communityApi } from "@/lib/community-api";

export function ConvexCesiumToken({ onToken }: { onToken: (token: string | null) => void }) {
  // Parent already mounts this only when Convex is available. Bypass the demo
  // check so the 3D views in demo mode still pull the token when the backend
  // is reachable.
  const config = useConvexSkipQuery(communityApi.clientConfig.get, { skipDemoCheck: true });
  useEffect(() => {
    // config is undefined while loading, null if query not found
    if (config !== undefined) {
      onToken((config as { cesiumIonToken?: string } | null)?.cesiumIonToken ?? null);
    }
  }, [config, onToken]);
  return null;
}
