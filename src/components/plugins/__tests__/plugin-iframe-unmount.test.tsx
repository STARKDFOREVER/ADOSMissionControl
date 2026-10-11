/**
 * @license GPL-3.0-only
 *
 * Teardown contract of the plugin iframe host: `{ type: "unmount" }` is posted
 * into the frame, and where the browser can move a frame without reloading it
 * the document stays alive for the grace window before removal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

import { PluginIframeHost, UNMOUNT_GRACE_MS } from "../PluginIframeHost";

const BUNDLE = "data:text/html;charset=utf-8,%3Cp%3Eplugin%3C%2Fp%3E";

type WithMoveBefore = { moveBefore?: (node: Node, child: Node | null) => void };
const proto = Element.prototype as unknown as WithMoveBefore;
const originalMoveBefore = proto.moveBefore;

function mountHost() {
  const view = render(
    <PluginIframeHost
      pluginId="com.example.unmount"
      slot="hardware.tab"
      bundleUrl={BUNDLE}
      grantedCapabilities={new Set<string>()}
      handlers={{}}
    />,
  );
  const iframe = view.container.querySelector("iframe")!;
  const postMessage = vi.fn();
  Object.defineProperty(iframe, "contentWindow", {
    configurable: true,
    value: { postMessage },
  });
  return { view, iframe, postMessage };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  proto.moveBefore = originalMoveBefore;
  if (originalMoveBefore === undefined) delete proto.moveBefore;
});

describe("PluginIframeHost unmount", () => {
  it("renders the sandboxed iframe with the slot attributes", () => {
    const { iframe } = mountHost();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("allow")).toBe("");
    expect(iframe.getAttribute("src")).toBe(BUNDLE);
    expect(iframe.dataset.pluginId).toBe("com.example.unmount");
  });

  it("posts unmount and keeps the frame alive for the grace window", () => {
    proto.moveBefore = function (this: Element, node: Node, child: Node | null) {
      this.insertBefore(node, child);
    };
    const { view, iframe, postMessage } = mountHost();
    view.unmount();

    expect(postMessage).toHaveBeenCalledWith({ type: "unmount" }, "*");
    expect(iframe.isConnected).toBe(true);
    vi.advanceTimersByTime(UNMOUNT_GRACE_MS - 1);
    expect(iframe.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect(iframe.isConnected).toBe(false);
  });

  it("still posts unmount where frames cannot be moved", () => {
    delete proto.moveBefore;
    const { view, iframe, postMessage } = mountHost();
    view.unmount();
    expect(postMessage).toHaveBeenCalledWith({ type: "unmount" }, "*");
    expect(iframe.isConnected).toBe(false);
  });
});
