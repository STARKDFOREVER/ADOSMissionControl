/**
 * Inactivity deadline and retransmit loop shared by every mission, fence and
 * rally transfer.
 *
 * @module protocol/mission-transfer-deadline
 */

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)))

/**
 * Deadline for an upload: MISSION_COUNT is re-sent until the vehicle asks for
 * its first item. From then on the vehicle drives the walk and retries its own
 * requests, so re-sending the count would restart the transfer.
 */
export function createUploadDeadline(
  onIdle: () => void,
  sendCount: () => void,
  isActive: () => boolean,
  onSendError: (err: Error) => void,
): TransferDeadline {
  let requested = false
  const deadline = createDeadline(onIdle, () => { if (!requested) sendCount() }, isActive, onSendError)
  const restart = deadline.restartTimer
  deadline.restartTimer = () => { requested = true; restart() }
  return deadline
}

/**
 * Shared shape of a `MISSION_REQUEST_INT` walk.
 *
 * `restartTimer` re-arms the inactivity deadline on EVERY received item, and
 * `reject` fires when that deadline expires with a short list. The three
 * downloads previously shared one 15 s wall-clock budget that RESOLVED
 * successfully with whatever had arrived: a single dropped
 * `MISSION_REQUEST_INT` stalled the walk, the timer handed back a truncated
 * list, `mission-store` set `downloadState: "downloaded"` and replaced the
 * plan, and the operator could save that short plan to disk or upload it back.
 * 15 s was also a hard cap on usable mission size over a 57k6 link.
 */
export interface TransferDeadline {
  /** Re-arm the inactivity deadline and the retransmit countdown. Called on each unit of progress. */
  restartTimer: () => void;
  /** Stop the inactivity deadline and the retransmit loop. Called on every settle path. */
  stop: () => void;
  timer: ReturnType<typeof setTimeout>
}

/**
 * Silence after which the GCS re-sends its outstanding request. The MAVLink
 * mission protocol puts retransmission on the GCS during a download (and on
 * MISSION_COUNT until the vehicle starts requesting items), so without it one
 * lost frame on a lossy radio stalled the walk until the idle deadline failed
 * the whole transfer.
 */
const TRANSFER_RETRY_MS = 1500

/**
 * Inactivity window for a mission/rally/fence transfer.
 *
 * Re-armed on every unit of progress, so the budget bounds a link that makes
 * no progress at all rather than the total transfer: a 300-item mission over a
 * 57k6 radio is a long transfer, not a failed one. Inside it the outstanding
 * request is re-sent every TRANSFER_RETRY_MS of silence.
 */
const TRANSFER_IDLE_TIMEOUT_MS = 15000

/**
 * Build the deadline for one transfer. `resend` re-issues whatever request the
 * transfer is waiting on; it runs after every TRANSFER_RETRY_MS without
 * progress for as long as `isActive()` holds (the transfer's slot on the
 * context still points at this state). `stop()` ends both timers and is called
 * by every path that settles the transfer. A resend that throws (a link that
 * cannot send) stops both timers and hands the error to `onSendError`, so a
 * refusal never escapes from a timer.
 */
export function createDeadline(
  onIdle: () => void,
  resend: () => void,
  isActive: () => boolean,
  onSendError: (err: Error) => void,
): TransferDeadline {
  let retry: ReturnType<typeof setInterval> | undefined
  const armRetry = () => {
    clearInterval(retry)
    retry = setInterval(() => {
      if (!isActive()) { clearInterval(retry); return }
      try {
        resend()
      } catch (err) {
        deadline.stop()
        onSendError(asError(err))
      }
    }, TRANSFER_RETRY_MS)
  }
  const expire = () => { clearInterval(retry); onIdle() }
  const deadline: TransferDeadline = {
    timer: setTimeout(expire, TRANSFER_IDLE_TIMEOUT_MS),
    restartTimer: () => {
      clearTimeout(deadline.timer)
      deadline.timer = setTimeout(expire, TRANSFER_IDLE_TIMEOUT_MS)
      armRetry()
    },
    stop: () => {
      clearTimeout(deadline.timer)
      clearInterval(retry)
    },
  }
  armRetry()
  return deadline
}

/**
 * Send a transfer's opening frame. On a throw the transfer is stopped and
 * failed through `onSendError` instead of leaving its slot and resend loop armed.
 */
export function sendOpening(state: TransferDeadline, send: () => void, onSendError: (err: Error) => void): void {
  try {
    send()
  } catch (err) {
    state.stop()
    onSendError(asError(err))
  }
}

