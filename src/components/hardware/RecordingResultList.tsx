"use client";

/**
 * @module RecordingResultList
 * @description The result of the last stopped capture: every segment file in
 * order, and how often the capture was interrupted. A capture whose ffmpeg
 * exited while still wanted (an RTSP end on a degrading link) continues in a
 * new segment, so one recording can span several files.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import type { RecordingControlResponse } from "@/lib/agent/agent-client/types";

export function RecordingResultList({ result }: { result: RecordingControlResponse }) {
  const t = useTranslations("hardware.lcdRecordingMonitor");
  const segments =
    result.segments ?? (result.filename ? [result.filename] : []);
  if (segments.length === 0) return null;
  const interrupted = result.interrupted_count ?? 0;
  return (
    <div
      className="flex flex-col gap-1 rounded border border-border-default bg-bg-tertiary px-3 py-2"
      data-testid="recording-result"
    >
      <span className="text-[11px] font-medium text-text-primary">
        {t("lastResult", { count: segments.length })}
      </span>
      {interrupted > 0 ? (
        <span role="status" className="text-[11px] text-status-warning">
          {t("interrupted", { count: interrupted })}
        </span>
      ) : null}
      <ol className="flex flex-col gap-0.5" role="list">
        {segments.map((name) => (
          <li key={name} className="font-mono text-[10px] text-text-tertiary truncate">
            {name}
          </li>
        ))}
      </ol>
    </div>
  );
}
