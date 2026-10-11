/**
 * @module vision-detector-select
 * @description Select a detector the node may not hold yet. The agent's
 * `PUT /api/vision/detector` answers 409 for a model id with no installed
 * file, so the GCS starts the download (202 + `status_url`), polls the job
 * until the model is installed, and then selects it again.
 * @license GPL-3.0-only
 */

import type {
  VisionDownloadResult,
  VisionModelStatus,
  VisionSetDetectorResult,
} from "./vision-client";

/** Fixed poll interval for a running model download. */
export const DETECTOR_DOWNLOAD_POLL_MS = 2_000;

/** What the select flow needs from a vision client. */
export interface DetectorSelectOps {
  /** One PUT of the detector; `notInstalled` when the agent answered 409. */
  putDetector(modelId: string): Promise<VisionSetDetectorResult & { notInstalled?: boolean }>;
  download(modelId: string): Promise<VisionDownloadResult>;
  modelStatus(modelId: string): Promise<VisionModelStatus>;
}

/**
 * Select `modelId`, downloading it first when the node does not hold it. The
 * download is polled at a fixed interval with no attempt cap; it ends when
 * the model is installed or the agent reports the download in `error`.
 */
export async function selectDetectorInstalling(
  ops: DetectorSelectOps,
  modelId: string,
  sleep: (ms: number) => Promise<void> = (ms) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
  },
): Promise<VisionSetDetectorResult> {
  const first = await ops.putDetector(modelId);
  if (!first.notInstalled) return first;
  const started = await ops.download(modelId);
  if (started.status !== "ok") {
    return { status: "error", message: started.message || "model download refused" };
  }
  for (;;) {
    await sleep(DETECTOR_DOWNLOAD_POLL_MS);
    const status = await ops.modelStatus(modelId);
    if (status.installed) break;
    if (status.download?.state === "error") {
      return { status: "error", message: `model ${modelId} download failed` };
    }
  }
  const second = await ops.putDetector(modelId);
  if (second.notInstalled) {
    return { status: "error", message: second.message };
  }
  return { status: second.status, message: second.message, modelId: second.modelId };
}
