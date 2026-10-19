"use client";

/**
 * @module command/nodes/ElrsModulesCard
 * @description One card per ExpressLRS transmitter module on a multi-module
 * node: id, role (pilot / autonomy), port, connection, link quality, RSSI per
 * antenna chain, SNR, TX power and RF mode. Unmeasured values read "…".
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { RadioTower } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ElrsModule } from "@/lib/api/ground-station/types";

const EMPTY = "…";
const KNOWN_ROLES: Record<string, true> = { pilot: true, autonomy: true };

const num = (v: number | null, unit: string) => (v === null ? EMPTY : `${v.toFixed(0)} ${unit}`);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border-default py-1 last:border-b-0">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="font-mono text-xs tabular-nums text-text-primary">{value}</dd>
    </div>
  );
}

export function ElrsModulesCard({ modules, stale }: { modules: readonly ElrsModule[]; stale: boolean }) {
  const t = useTranslations("rcElrsLink.modules");
  return (
    <section
      aria-label={t("title")}
      className={cn("rounded border border-border-default bg-bg-secondary p-5", stale && "opacity-60")}
    >
      <div className="mb-1 flex items-center gap-2">
        <RadioTower size={16} className="text-accent-primary" />
        <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>
      </div>
      <p className="mb-4 text-xs text-text-tertiary">{t("description")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {modules.map((m) => (
          <div key={m.id} role="group" aria-label={m.id} className="rounded border border-border-default p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-text-primary">{m.id}</span>
              <span className="rounded border border-accent-primary/40 bg-accent-primary/10 px-2 py-0.5 text-[11px] text-accent-primary">
                {m.role === null
                  ? t("role.unknown")
                  : Object.hasOwn(KNOWN_ROLES, m.role)
                    ? t(`role.${m.role}`)
                    : m.role}
              </span>
              <span
                className={cn(
                  "rounded border px-2 py-0.5 text-[11px]",
                  m.connected === true
                    ? "border-status-success/40 bg-status-success/10 text-status-success"
                    : m.connected === false
                      ? "border-status-error/40 bg-status-error/10 text-status-error"
                      : "border-border-default bg-bg-tertiary text-text-tertiary",
                )}
              >
                {m.connected === true
                  ? t("connected")
                  : m.connected === false
                    ? t("disconnected")
                    : t("connectionUnknown")}
              </span>
            </div>
            <dl>
              <Row label={t("port")} value={m.port ?? EMPTY} />
              <Row label={t("lq")} value={m.lq === null ? EMPTY : `${m.lq.toFixed(0)}%`} />
              {m.rssiDbm.length === 0 ? (
                <Row label={t("rssi")} value={EMPTY} />
              ) : (
                m.rssiDbm.map((v, i) => (
                  <Row key={i} label={t("rssiChain", { chain: i + 1 })} value={num(v, "dBm")} />
                ))
              )}
              <Row label={t("snr")} value={num(m.snrDb, "dB")} />
              <Row label={t("txPower")} value={num(m.txPowerMw, "mW")} />
              <Row label={t("rfMode")} value={m.rfMode ?? EMPTY} />
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
