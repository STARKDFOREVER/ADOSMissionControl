/**
 * @module reconnecting-socket-close.test
 * @description A peer-initiated close reaches `onClose` with its code and
 * reason before the loop redials; a teardown close does not.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  openReconnectingSocket,
  type ReconnectingSocketLike,
} from "@/lib/net/reconnecting-socket";

function fakeSocket(): ReconnectingSocketLike {
  return { onopen: null, onmessage: null, onclose: null, onerror: null, close: () => {} };
}

describe("openReconnectingSocket onClose", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports the peer's close code and reason, then redials", () => {
    const sockets: ReconnectingSocketLike[] = [];
    const onClose = vi.fn();
    const stop = openReconnectingSocket({
      open: () => {
        const ws = fakeSocket();
        sockets.push(ws);
        return ws;
      },
      onMessage: () => {},
      onClose,
    });
    sockets[0].onclose?.({ code: 1011, reason: '{"available":false}' } as CloseEvent);
    expect(onClose).toHaveBeenCalledWith(1011, '{"available":false}');
    vi.advanceTimersByTime(3000);
    expect(sockets).toHaveLength(2);
    stop();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
