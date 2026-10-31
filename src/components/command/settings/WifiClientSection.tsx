"use client";

/**
 * @module command/settings/WifiClientSection
 * @description The node Settings "Wi-Fi" page: current station connection,
 * scan → join, disconnect, and the saved-network list (autoconnect / forget)
 * over the agent's profile-agnostic `/api/v1/network/client/*` surface —
 * served on every profile, since joining a bench network only needs a wlan
 * interface.
 *
 * Honesty rules: the connection state is the agent's own report (an agent
 * whose Wi-Fi manager is unreachable answers 503, which reads as "status
 * could not be read", never as "not connected"); a 404/501 scan
 * renders "not exposed by this agent version" instead of an empty list; the
 * passphrase is write-only — sent to the node on join, cleared locally,
 * never echoed back.
 * @license GPL-3.0-only
 */
import { useTranslations } from "next-intl";
import { Wifi } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ReadRow, Section } from "./Section";
import { useWifiClient } from "./use-wifi-client";

export function WifiClientSection({
  nodeDeviceId,
}: {
  /** The node this page is rendered for. Reads and writes go only to a
   * connection attached to this node; any other node's page reads "needs a
   * LAN connection" rather than acting on the focused one. */
  nodeDeviceId: string | null;
}) {
  const t = useTranslations("nodeSettings");
  const {
    agent,
    ctx,
    status,
    statusFailed,
    saved,
    networks,
    scanning,
    scanError,
    ssid,
    setSsid,
    passphrase,
    setPassphrase,
    joining,
    forcePrompt,
    setForcePrompt,
    leavePrompt,
    setLeavePrompt,
    leaving,
    forgetPrompt,
    setForgetPrompt,
    rowBusy,
    onScan,
    doJoin,
    onLeave,
    onForget,
    onAutoconnect,
    pickNetwork,
  } = useWifiClient(nodeDeviceId);

  return (
    <Section title={t("wifi.title")} icon={Wifi} blurb={t("wifi.blurb")}>
      {!ctx ? (
        <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
          {t("network.liveRequiresLan")}
        </div>
      ) : (
        <>
          {/* Current connection — the agent's own report. */}
          <div className="space-y-2">
            <div className="text-xs text-text-secondary">
              {t("wifi.currentTitle")}
            </div>
            {statusFailed ? (
              <p className="text-[11px] text-status-error">
                {t("wifi.statusFailed")}
              </p>
            ) : status?.connected ? (
              <div className="space-y-1.5 rounded border border-border-default/40 bg-bg-tertiary px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-text-primary">
                    {status.ssid ?? t("wifi.unknownSsid")}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setLeavePrompt(true)}
                    disabled={leaving}
                  >
                    {leaving ? t("saving") : t("wifi.leaveAction")}
                  </Button>
                </div>
                {status.signal !== null ? (
                  <ReadRow label={t("wifi.signalLabel")} value={`${status.signal}%`} />
                ) : null}
                {status.ip ? <ReadRow label={t("wifi.ipLabel")} value={status.ip} /> : null}
                {status.security ? (
                  <ReadRow label={t("wifi.securityLabel")} value={status.security} />
                ) : null}
              </div>
            ) : (
              <p className="text-[11px] text-text-tertiary">
                {t("wifi.noConnectionReported")}
              </p>
            )}
          </div>

          {/* Join a network (manual SSID entry works for hidden networks). */}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void doJoin(false);
            }}
          >
            <div className="text-xs text-text-secondary">
              {t("wifi.joinTitle")}
            </div>
            <Input
              id="wifi-join-ssid"
              label={t("wifi.ssidLabel")}
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              placeholder={t("wifi.ssidPlaceholder")}
              disabled={joining}
            />
            <Input
              id="wifi-join-passphrase"
              label={t("wifi.passwordLabel")}
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t("wifi.passwordPlaceholder")}
              disabled={joining}
            />
            <p className="text-[11px] text-text-tertiary">
              {t("wifi.passwordHint")}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={joining || ssid.trim().length === 0}
              >
                {joining ? t("wifi.joining") : t("wifi.joinAction")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void onScan()}
                disabled={scanning}
              >
                {scanning ? t("wifi.scanning") : t("wifi.scanAction")}
              </Button>
            </div>
          </form>

          {/* Scan results. */}
          {scanError ? (
            <p className="text-[11px] text-text-tertiary">
              {scanError.unexposed
                ? t("wifi.scanUnsupported")
                : t("wifi.scanFailed", { message: scanError.message })}
            </p>
          ) : networks !== null ? (
            networks.length === 0 ? (
              <p className="text-[11px] text-text-tertiary">
                {t("wifi.scanEmpty")}
              </p>
            ) : (
              <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                {networks.map((n) => (
                  <li key={`${n.ssid}-${n.bssid}`}>
                    <button
                      type="button"
                      onClick={() => pickNetwork(n)}
                      className="flex w-full items-center justify-between gap-3 rounded border border-border-default/40 bg-bg-tertiary px-3 py-2 text-left hover:border-accent-primary focus:border-accent-primary focus:outline-none"
                      aria-label={t("wifi.useNetwork", { ssid: n.ssid })}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm text-text-primary">
                          {n.ssid}
                        </span>
                        {n.in_use ? (
                          <span className="rounded border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-success">
                            {t("wifi.inUse")}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-2 font-mono text-[11px] text-text-tertiary">
                        <span>{n.security || t("wifi.openNetwork")}</span>
                        <span>{n.signal}%</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {/* Saved networks. */}
          <div className="space-y-2 border-t border-border-default pt-3">
            <div className="text-xs text-text-secondary">
              {t("wifi.savedTitle")}
            </div>
            {saved === null ? (
              <p className="text-[11px] text-text-tertiary">
                {t("wifi.savedNotReported")}
              </p>
            ) : saved.length === 0 ? (
              <p className="text-[11px] text-text-tertiary">
                {t("wifi.savedEmpty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {saved.map((c) => (
                  <li
                    key={c.name}
                    className="flex items-center justify-between gap-3 rounded border border-border-default/40 bg-bg-tertiary px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-text-primary">
                        {c.name}
                      </div>
                      {c.device ? (
                        <div className="font-mono text-[10px] text-text-tertiary">
                          {c.device}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Toggle
                        label={t("wifi.autoconnectLabel")}
                        checked={c.autoconnect}
                        onChange={(v) => void onAutoconnect(c.name, v)}
                        disabled={rowBusy !== null}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setForgetPrompt(c.name)}
                        disabled={rowBusy !== null}
                      >
                        {t("wifi.forgetAction")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Force-join: the node's AP holds the radio; joining takes it over. */}
      <ConfirmDialog
        open={forcePrompt}
        title={t("wifi.forceTitle")}
        message={t("wifi.forceMessage")}
        confirmLabel={t("wifi.forceConfirm")}
        variant="danger"
        onCancel={() => setForcePrompt(false)}
        onConfirm={() => {
          setForcePrompt(false);
          void doJoin(true);
        }}
      />
      <ConfirmDialog
        open={leavePrompt}
        title={t("wifi.leaveTitle")}
        message={t("wifi.leaveMessage", {
          ssid: status?.ssid ?? t("wifi.unknownSsid"),
        })}
        confirmLabel={t("wifi.leaveConfirm")}
        variant="danger"
        onCancel={() => setLeavePrompt(false)}
        onConfirm={() => {
          setLeavePrompt(false);
          void onLeave();
        }}
      />
      <ConfirmDialog
        open={forgetPrompt !== null}
        title={t("wifi.forgetTitle")}
        message={t("wifi.forgetMessage", { name: forgetPrompt ?? "" })}
        confirmLabel={t("wifi.forgetConfirm")}
        variant="danger"
        onCancel={() => setForgetPrompt(null)}
        onConfirm={() => {
          const name = forgetPrompt;
          setForgetPrompt(null);
          if (name) void onForget(name);
        }}
      />
    </Section>
  );
}
