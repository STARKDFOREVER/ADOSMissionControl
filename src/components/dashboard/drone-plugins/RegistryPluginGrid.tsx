"use client";

/**
 * @module RegistryPluginGrid
 * @description Inline registry catalog rendered on the per-drone Plugins
 * tab below the installed list. Surfaces every published first-party
 * plugin via Convex `pluginRegistry.listPlugins`, applies client-side
 * search + category filtering, and on Install click reads the version
 * row's manifest YAML, parses it for the dialog preview, and opens
 * `<PluginInstallDialog>` directly at the `review` stage. The dialog
 * then hands the URL + SHA256 pin to the agent's
 * `POST /api/plugins/install_from_url` endpoint so the archive is never
 * pulled through the browser.
 *
 * Already-installed plugins (read from `cmdPlugins:listForDevice`)
 * render with an Installed pill and a disabled Install button. The
 * compat hook gates Install on each card against the connected drone's
 * agent version + board.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { api } from "../../../../convex/_generated/api";
import { useConvexAvailable } from "@/hooks/use-convex-available";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useLocalPluginInstallsStore } from "@/stores/local-plugin-installs-store";
import { useNodePluginList } from "@/hooks/use-node-plugin-list";
import { isDemoMode } from "@/lib/utils";

import { PluginInstallDialog } from "@/components/plugins/PluginInstallDialog";
import type {
  InstallTargetDrone,
  InstallManifestSummary,
  InstallSource,
} from "@/components/plugins/install-dialog/types";
import { parseManifestYaml } from "@/components/plugins/transports/manifest-parse";
import { toInstallSummary } from "@/components/plugins/transports/manifest-summary";

import type { RegistryPluginRow } from "@/lib/plugins/registry-row";

import {
  RegistryCatalogBrowser,
  RegistrySectionHeader,
} from "./RegistryCatalogBrowser";
import { RegistryPluginCard } from "./RegistryPluginCard";
// The demo catalog is a fixture set that only ever renders under demo mode.
// Loaded on demand so its fixtures stay out of the initial bundle.
const DemoRegistryGrid = dynamic(
  () => import("./DemoRegistryGrid").then((m) => m.DemoRegistryGrid),
  { ssr: false },
);

interface ListPluginsResult {
  items: ReadonlyArray<RegistryPluginRow>;
  nextCursor: string | null;
  total: number;
}

type CardState = "loading" | { error: string } | undefined;

interface PendingInstall {
  manifest: InstallManifestSummary;
  manifestHash: string;
  source: Extract<InstallSource, { kind: "registry" }>;
}

export interface RegistryPluginGridProps {
  /** Drone the install lands on. The per-drone Plugins tab passes the
   * active drone; the Settings → Plugins home passes the operator's
   * chosen target from its drone picker. Null only while no drone is
   * selectable (the grid still renders the catalog read-only). */
  target?: InstallTargetDrone | null;
  /** Rendering context passed straight through to `RegistryPluginCard`.
   * `"node"` (default): per-drone Extensions tab, Install kicks off the
   * archive-fetch + review flow. `"settings"`: fleet-wide read-only
   * overview, Install opens a node picker instead. */
  surface?: "node" | "settings";
  /** Registry plugin id to scroll to + highlight on mount (a Settings
   * "Install on a node…" hand-off). */
  preselectPluginId?: string | null;
}

export function RegistryPluginGrid({
  target = null,
  surface = "node",
  preselectPluginId = null,
}: RegistryPluginGridProps) {
  const t = useTranslations("pluginRegistry.browse");
  const convexAvailable = useConvexAvailable();

  const deviceId = target?.deviceId ?? null;

  const catalog = useQuery(
    api.pluginRegistry.listPlugins,
    convexAvailable && !isDemoMode() ? {} : "skip",
  ) as ListPluginsResult | undefined;

  // Already-installed plugin ids so we can mark cards. The Convex
  // per-device query returns an empty list for unauthenticated callers
  // (correct for LAN-only mode); a LAN-paired node's own install list
  // covers what is on it however it got there, and the local-first record
  // covers a GCS-only plugin installed with no cloud session.
  const installs = useConvexSkipQuery(api.cmdPlugins.listForDevice, {
    args: { deviceId: deviceId ?? "" },
    enabled: !isDemoMode() && deviceId !== null,
  });
  const nodeInstalls = useNodePluginList(deviceId);
  const localInstalls = useLocalPluginInstallsStore((s) => s.installs);
  const installedIds = useMemo(() => {
    const ids = new Set<string>();
    if (installs) for (const row of installs) ids.add(row.pluginId);
    if (nodeInstalls) for (const row of nodeInstalls) ids.add(row.plugin_id);
    // Local records for this scope (a specific drone, or the fleet/GCS
    // bucket when there is no drone).
    for (const i of localInstalls) {
      if (i.deviceId === deviceId) ids.add(i.pluginId);
    }
    return ids;
  }, [installs, nodeInstalls, localInstalls, deviceId]);

  const [cardState, setCardState] = useState<Record<string, CardState>>({});
  const [pending, setPending] = useState<PendingInstall | null>(null);
  const [pendingFetch, setPendingFetch] = useState<{
    pluginId: string;
    version: string;
  } | null>(null);

  // Drive the version lookup reactively so the install handler can
  // wait for the result without an action hop. Convex deduplicates
  // overlapping subscriptions across cards that share an id.
  const versionRow = useQuery(
    api.pluginRegistry.getVersion,
    pendingFetch && convexAvailable
      ? { pluginId: pendingFetch.pluginId, version: pendingFetch.version }
      : "skip",
  );

  const installTarget = target;

  // Once the version row resolves, parse its embedded manifest yaml
  // and open the dialog with a registry-source descriptor.
  useEffect(() => {
    if (!pendingFetch || versionRow === undefined) return;
    const key = pendingFetch.pluginId;
    const targetVersion = pendingFetch.version;
    setPendingFetch(null);
    if (!versionRow) {
      setCardState((prev) => ({
        ...prev,
        [key]: { error: `[registry.lookup] version row missing` },
      }));
      return;
    }
    (async () => {
      try {
        const yaml = versionRow.manifest_yaml;
        const parsed = parseManifestYaml(yaml);
        const hashBytes = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(yaml),
        );
        const manifestHash = Array.from(new Uint8Array(hashBytes))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        // The browser holds no archive bytes at preview time (the row carries
        // manifest YAML and a URL), and the row's `signer_key_id` is a stored
        // claim, not a verification result — so the preview asserts no trust.
        // `finalizeGcsInstall` fetches the archive it is about to execute and
        // verifies the signature there before anything is recorded.
        const summary = toInstallSummary(parsed, manifestHash, {
          signatureState: "unverified",
          vendorAttribution: versionRow.vendor_attribution
            ? versionRow.vendor_attribution.map((v) => ({ ...v }))
            : undefined,
          archiveSha256: versionRow.archive_sha256,
        });

        setCardState((prev) => ({ ...prev, [key]: undefined }));
        setPending({
          manifest: summary,
          manifestHash,
          source: {
            kind: "registry",
            url: versionRow.download_url,
            expectedSha256: versionRow.archive_sha256,
            pluginId: key,
            version: targetVersion,
          },
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        console.error("[plugin install]", key, "manifest.parse", err);
        setCardState((prev) => ({
          ...prev,
          [key]: { error: `[manifest.parse] ${raw}` },
        }));
      }
    })();
  }, [pendingFetch, versionRow]);

  const handleInstall = useCallback((plugin: RegistryPluginRow) => {
    const key = plugin.plugin_id;
    setCardState((prev) => ({ ...prev, [key]: "loading" }));
    setPendingFetch({ pluginId: key, version: plugin.latest_version });
  }, []);

  // Demo mode: the live registry is Convex-backed and unreachable, so render a
  // fixture catalog that opens the same install / detail pop-up (demo mode works offline).
  if (isDemoMode()) {
    return <DemoRegistryGrid target={target} />;
  }

  if (!convexAvailable) {
    return (
      <section className="space-y-2">
        <RegistrySectionHeader />
        <ErrorMessage text={t("error.unavailable")} />
      </section>
    );
  }

  return (
    <RegistryCatalogBrowser
      rows={catalog?.items}
      preselectPluginId={preselectPluginId}
      renderCard={(plugin) => (
        <RegistryPluginCard
          key={plugin._id}
          plugin={plugin}
          installed={installedIds.has(plugin.plugin_id)}
          state={cardState[plugin.plugin_id]}
          onInstall={() => handleInstall(plugin)}
          surface={surface}
          targetDeviceId={installTarget?.deviceId ?? null}
          highlighted={preselectPluginId === plugin.plugin_id}
        />
      )}
    >
      <PluginInstallDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        targetDevice={installTarget}
        initialManifest={pending?.manifest}
        initialManifestHash={pending?.manifestHash}
        initialSource={pending?.source}
      />
    </RegistryCatalogBrowser>
  );
}

function ErrorMessage({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">
      {text}
    </div>
  );
}
