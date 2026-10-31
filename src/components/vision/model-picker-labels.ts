import type { ModelFitReason } from "@/lib/vision/model-filter";

export const POLL_INTERVAL_MS = 1500;
export const TERMINAL_STATES = new Set(["complete", "error", "idle"]);

export interface DownloadState {
  state: string;
  percent: number;
}

export type PickerMode = "full" | "compact";

/** Map a fit reason to a short human badge label. */
export function fitLabel(reason: ModelFitReason): string {
  switch (reason) {
    case "needs_npu":
      return "Needs NPU";
    case "runtime_mismatch":
      return "Runtime mismatch";
    case "insufficient_tops":
      return "Low TOPS";
    case "board_mismatch":
      return "Other board";
    default:
      return "";
  }
}
