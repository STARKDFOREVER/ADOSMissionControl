import { useCallback, useEffect, useState } from "react";
import { TILE_CONNECT_TIMEOUT_MS } from "./agent-feed-tile-format";

/** Retry key for a tile's video session, bumped by {@link retry}. */
export function useFeedVideoRetry() {
  const [retryKey, setRetryKey] = useState(0);
  const retry = useCallback(() => setRetryKey((k) => k + 1), []);
  return { retryKey, retry };
}

/**
 * A tile that has been "connecting" longer than the timeout is wedged: force
 * a fresh session attempt rather than spinning the placeholder forever.
 */
export function useConnectWatchdog(connecting: boolean, retry: () => void): void {
  useEffect(() => {
    if (!connecting) return;
    const handle = setTimeout(retry, TILE_CONNECT_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [connecting, retry]);
}
