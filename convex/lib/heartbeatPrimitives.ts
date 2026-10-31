/**
 * @module convex/lib/heartbeatPrimitives
 * @description Scalar field readers for the agent-facing HTTP routes: type-check
 * one key of a parsed JSON body, bound a string, and read the key set an
 * object validator declares. Pure functions with no Convex dependency.
 *
 * @license GPL-3.0-only
 */

/** Shared JSON response header, mirroring the one in `http.ts`. */
export const jsonHeaders = { "Content-Type": "application/json" };

export function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * A string field with a hard length cap, or a 400 `Response` when the caller
 * exceeded it.
 *
 * `stringField` type-checks but never length-checks, and the device routes
 * write ~140 such fields straight to the DB with the 512 KB body cap as the
 * only bound — per request, on a route devices call every 5 s. Anything
 * persisted AND rendered gets an explicit cap.
 */
export function boundedField(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined | Response {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  if (value.length > maxLength) {
    return new Response(
      JSON.stringify({ error: `${key} exceeds ${maxLength} characters` }),
      { status: 400, headers: jsonHeaders },
    );
  }
  return value;
}

export function numberField(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  return typeof value === "number" ? value : undefined;
}

export function booleanField(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}

export function numberArrayField(
  body: Record<string, unknown>,
  key: string,
): number[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "number") ? value : undefined;
}

export function stringArrayField(
  body: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}

export function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number") return value;
  return undefined;
}

export function nullableBoolean(value: unknown): boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  return undefined;
}

export function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

/**
 * The keys an object validator declares, or null when it is not an object
 * validator. Read from the validator at runtime so a filter built on it can
 * never drift from the schema it guards.
 */
export function declaredKeys(validator: unknown): Set<string> | null {
  const fields = (validator as { fields?: Record<string, unknown> } | undefined)?.fields;
  if (!fields || typeof fields !== "object") return null;
  return new Set(Object.keys(fields));
}
