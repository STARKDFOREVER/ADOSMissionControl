/**
 * @module upload-digest
 * @description The body digest a streaming upload declares to the agent.
 * The plugin archive routes (`/api/plugins/parse`, `/api/plugins/install`)
 * and the vision model upload hash the file while it streams and refuse a
 * mismatch with 401 `E_DIGEST_MISMATCH`, so a truncated or altered transfer
 * never lands on the node. The digest is the lowercase hex SHA-256 of the
 * uploaded file's bytes, sent as `X-Content-SHA256`.
 *
 * The same module maps the upload refusals to operator copy: 429 `E_BUSY`
 * (one archive in flight at a time) and 401 `E_DIGEST_MISMATCH`.
 * @license GPL-3.0-only
 */

/** The request header carrying the declared body digest. */
export const CONTENT_DIGEST_HEADER = "X-Content-SHA256";

/** The `{ "X-Content-SHA256": <hex> }` header for an upload of `blob`: the
 * lowercase hex SHA-256 of its bytes, via WebCrypto. */
export async function contentDigestHeader(
  blob: Blob,
): Promise<Record<string, string>> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
  );
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return { [CONTENT_DIGEST_HEADER]: hex };
}

/** Operator copy for an upload refusal the agent answers with a top-level
 * `error` code, or null when the response is not one of them. */
export function uploadRefusalCopy(status: number, body: unknown): string | null {
  const error =
    body && typeof body === "object" && "error" in body ? body.error : null;
  if (status === 429 && (error === "E_BUSY" || error === null)) {
    return "Another install is running on this node. Try again when it finishes.";
  }
  if (status === 401 && error === "E_DIGEST_MISMATCH") {
    return "The upload arrived altered or incomplete (checksum mismatch). Retry the upload.";
  }
  return null;
}
