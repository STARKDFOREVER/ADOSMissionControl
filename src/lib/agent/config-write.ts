/**
 * @module agent/config-write
 * @description The agent config-write contract, transport-independent.
 *
 * `PUT /api/config` has these outcomes: the value landed (200, `persisted:
 * true`); the value was rejected (200 with `{error}` in the body); the value
 * failed the field's schema (422 `{code: "E_VALIDATION", key, messages}`);
 * the value broke a cross-field rule (422 `{error: "E_INVALID", field,
 * message}`); or the config file could not be written (500 with `persisted:
 * false` and the agent's `persist_error`). Only the first took effect.
 *
 * Every caller on every lane (the direct LAN client, the server-side config
 * proxy, the ground station's relay-proxy) therefore derives success from
 * `configWriteFailure` and nothing else, and every transport hands a refusal
 * body back as a result (`configWriteRefusalBody`) rather than a bare HTTP
 * error, so the operator sees the node's own reason. Kept free of store and
 * React imports so the transport layer can use it too.
 * @license GPL-3.0-only
 */

/** Response shape of the agent's single-key config write. */
export interface ConfigWriteResult {
  status?: string;
  key?: string;
  value?: unknown;
  /** The agent's rejection reason for an unknown key or an uncoercible value
   * (a 200 body), or the `E_INVALID` code of a cross-field refusal (422). */
  error?: string;
  /** The dotted key a 422 `E_INVALID` refusal names. */
  field?: string;
  /** The cross-field rule's operator message on a 422 `E_INVALID`. */
  message?: string;
  /** `E_VALIDATION` on a 422 schema refusal. */
  code?: string;
  /** The schema's per-field messages on a 422 `E_VALIDATION`. */
  messages?: unknown;
  /** False when the config file could not be written (a non-root agent, a
   * full or read-only `/etc`, a lock/rename failure); the write then had no
   * effect. */
  persisted?: boolean;
  /** The agent's reason for the failed disk write. */
  persist_error?: string;
}

/** What the operator is told when the node could not store a value. Names
 * the consequence (nothing changed) and the action (fix the node's own config
 * path). */
export const PERSIST_FAILED_MESSAGE =
  "The node could not write this value to its config file, so nothing was changed. Check the agent's own config path (/etc/ados/config.yaml) — a non-root agent or a full/read-only filesystem cannot persist — then apply it again.";

/**
 * The write route's refusal carried by a non-2xx response (the 500 persist
 * failure, the 422 `E_INVALID` and `E_VALIDATION` refusals), or null when the
 * body is anything else. Transports return it as the write's result so
 * `configWriteFailure` names the node's reason.
 */
export function configWriteRefusalBody(body: unknown): ConfigWriteResult | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  // A JSON object body; every field below is read optionally and type-checked.
  const row = body as ConfigWriteResult;
  if (row.persisted === false) return row;
  if (row.error === "E_INVALID" || row.code === "E_VALIDATION") return row;
  return null;
}

/** The schema messages of an `E_VALIDATION` refusal, flattened. */
function validationMessages(messages: unknown): string[] {
  if (typeof messages === "string") return [messages];
  if (Array.isArray(messages)) {
    return messages.flatMap((m) => validationMessages(m));
  }
  if (messages && typeof messages === "object") {
    return Object.values(messages).flatMap((m) => validationMessages(m));
  }
  return [];
}

/**
 * The reason a config write did not land, or null when it did.
 *
 * ONE truth check for every caller: a caller that hand-rolls half of the pair
 * reports "Saved" for a change the node never stored.
 */
export function configWriteFailure(
  res: ConfigWriteResult | null | undefined,
): string | null {
  if (!res) return null;
  if (res.error === "E_INVALID") {
    const message =
      typeof res.message === "string" && res.message.length > 0
        ? res.message
        : "The node refused this value: it conflicts with another setting.";
    return typeof res.field === "string" ? `${res.field}: ${message}` : message;
  }
  if (res.code === "E_VALIDATION") {
    const lines = validationMessages(res.messages);
    const key = typeof res.key === "string" ? `${res.key}: ` : "";
    return `${key}${lines.length > 0 ? lines.join("; ") : "the node rejected this value"}`;
  }
  if (typeof res.error === "string") return res.error;
  if (res.persisted === false) {
    const reason =
      typeof res.persist_error === "string" && res.persist_error.length > 0
        ? res.persist_error
        : null;
    return reason
      ? `${PERSIST_FAILED_MESSAGE} (node reported: ${reason})`
      : PERSIST_FAILED_MESSAGE;
  }
  return null;
}
