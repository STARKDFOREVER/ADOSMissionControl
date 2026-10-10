/**
 * @module plugin-armed-retry.test
 * @description Plugin lifecycle calls refused with 409 `E_ARMED` ask the
 * operator and resend with the override: `force: true` in the body for
 * enable/disable, `?force=1` for remove and the multipart install. A
 * declined prompt surfaces the refusal; a remove warning reaches the UI.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { PluginAgentClient } from "@/lib/agent/plugin-client";
import {
  PLUGIN_ARMED_CONFIRM_MESSAGE,
  registerPluginLifecycleUi,
} from "@/lib/agent/plugin-lifecycle";
import { AgentArmedRefusal, armedRefusalFrom } from "@/lib/agent/agent-client/transport";
import { installLanDirectFromUrl } from "../../transports/lan-direct-url";

const ARMED_TOP = JSON.stringify({ error: "E_ARMED", override: "force" });
const ARMED_NESTED = JSON.stringify({ detail: { error: "E_ARMED", override: "force" } });

interface Call {
  url: string;
  method?: string;
  body?: unknown;
}

function scripted(responses: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit | undefined) => {
    calls.push({ url, method: init?.method, body: init?.body });
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return next;
  };
  return { calls, client: new PluginAgentClient("http://192.168.1.50:8080", "k", fetchImpl) };
}

let unregister: (() => void) | null = null;
afterEach(() => {
  unregister?.();
  unregister = null;
});

function mountUi(confirmed: boolean) {
  const confirmArmed = vi.fn(async () => confirmed);
  const warn = vi.fn();
  unregister = registerPluginLifecycleUi({ confirmArmed, warn });
  return { confirmArmed, warn };
}

describe("plugin lifecycle E_ARMED retry", () => {
  it("confirms and resends enable with force in the body", async () => {
    const ui = mountUi(true);
    const { calls, client } = scripted([
      new Response(ARMED_TOP, { status: 409 }),
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ]);
    await client.enable("com.example.basic");
    expect(ui.confirmArmed).toHaveBeenCalledWith(PLUGIN_ARMED_CONFIRM_MESSAGE);
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toBeUndefined();
    expect(JSON.parse(String(calls[1].body))).toEqual({ force: true });
  });

  it("accepts the refusal nested under detail", async () => {
    mountUi(true);
    const { calls, client } = scripted([
      new Response(ARMED_NESTED, { status: 409 }),
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ]);
    await client.disable("com.example.basic");
    expect(calls[1].url).toMatch(/\/disable$/);
    expect(JSON.parse(String(calls[1].body))).toEqual({ force: true });
  });

  it("resends remove with ?force=1 and toasts the host warning", async () => {
    const ui = mountUi(true);
    const { calls, client } = scripted([
      new Response(ARMED_TOP, { status: 409 }),
      new Response(JSON.stringify({ ok: true, warning: "service log left behind" }), {
        status: 200,
      }),
    ]);
    const out = await client.remove("com.example.basic");
    expect(calls[0].url).not.toContain("force");
    expect(calls[1].url).toMatch(/\?force=1$/);
    expect(calls[1].method).toBe("DELETE");
    expect(out.warning).toBe("service log left behind");
    expect(ui.warn).toHaveBeenCalledWith("service log left behind");
  });

  it("resends install with ?force=1", async () => {
    mountUi(true);
    const { calls, client } = scripted([
      new Response(ARMED_TOP, { status: 409 }),
      new Response(
        JSON.stringify({
          ok: true,
          plugin_id: "com.example.basic",
          version: "0.1.0",
          signer_id: null,
          risk: "low",
          permissions_requested: [],
        }),
        { status: 200 },
      ),
    ]);
    await client.install(new File([new Uint8Array([1])], "p.adosplug"));
    expect(calls[1].url).toMatch(/\/api\/plugins\/install\?force=1$/);
  });

  it("rethrows the refusal when the operator declines", async () => {
    mountUi(false);
    const { calls, client } = scripted([new Response(ARMED_TOP, { status: 409 })]);
    await expect(client.enable("com.example.basic")).rejects.toBeInstanceOf(AgentArmedRefusal);
    expect(calls).toHaveLength(1);
  });

  it("reads E_ARMED at the top level or nested under detail", () => {
    expect(armedRefusalFrom(409, ARMED_TOP)).toBeInstanceOf(AgentArmedRefusal);
    expect(armedRefusalFrom(409, ARMED_NESTED)).toBeInstanceOf(AgentArmedRefusal);
    expect(armedRefusalFrom(409, JSON.stringify({ detail: { error: "E_OTHER" } }))).toBeNull();
    expect(armedRefusalFrom(400, ARMED_NESTED)).toBeNull();
  });

  it("resends the LAN install_from_url with force in the body", async () => {
    const { confirmArmed } = mountUi(true);
    const bodies: unknown[] = [];
    const responses = [
      new Response(ARMED_NESTED, { status: 409 }),
      new Response(JSON.stringify({ plugin_id: "com.example.basic", job_id: "j1" }), { status: 200 }),
    ];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/install_from_url")) {
        bodies.push(JSON.parse(String(init?.body)));
        return responses.shift()!;
      }
      return new Response("{}", { status: 200 });
    });
    try {
      await installLanDirectFromUrl({
        agentUrl: "http://192.168.1.50:8080",
        pairingKey: "k",
        url: "https://example.com/a.adosplug",
        expectedSha256: "0".repeat(64),
        grantedPermissions: [],
        jobId: "j1",
        pluginId: "com.example.basic",
        pluginName: "Basic",
        deviceId: "d1",
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(confirmArmed).toHaveBeenCalledOnce();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).not.toHaveProperty("force");
    expect(bodies[1]).toMatchObject({ force: true, job_id: "j1" });
  });
});
