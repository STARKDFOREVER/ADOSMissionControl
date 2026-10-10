/**
 * Unit tests for the ground-station store's error normaliser.
 *
 * The helper is the gate for every catch site in the store. It must
 * surface a readable message for the UI regardless of whether the
 * error is a thrown string, a native Error, a network failure, or a
 * GroundStationApiError carrying a JSON body with detail or message
 * fields.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { errorMessage } from "@/stores/ground-station-store";
import { GroundStationApiError } from "@/lib/api/ground-station-api";

describe("errorMessage", () => {
  it("returns the parsed detail field when the API body is JSON with a detail key", () => {
    const err = new GroundStationApiError(400, JSON.stringify({ detail: "WFB tx is busy" }));
    const result = errorMessage(err);
    expect(result.message).toBe("WFB tx is busy");
    expect(result.status).toBe(400);
  });

  it("falls back to the message field when the API body has no detail", () => {
    const err = new GroundStationApiError(409, JSON.stringify({ message: "Already paired" }));
    const result = errorMessage(err);
    expect(result.message).toBe("Already paired");
    expect(result.status).toBe(409);
  });

  it("returns the raw body when the API body is non-JSON", () => {
    const err = new GroundStationApiError(500, "Internal Server Error");
    const result = errorMessage(err);
    expect(result.message).toBe("Internal Server Error");
    expect(result.status).toBe(500);
  });

  it("propagates the status code on a 404 error", () => {
    const err = new GroundStationApiError(404, JSON.stringify({ detail: "Not found" }));
    const result = errorMessage(err);
    expect(result.message).toBe("Not found");
    expect(result.status).toBe(404);
  });

  it("returns null status for a thrown native Error", () => {
    const err = new Error("Network unreachable");
    const result = errorMessage(err);
    expect(result.message).toBe("Network unreachable");
    expect(result.status).toBe(null);
  });

  it("returns Unknown error with null status for a non-Error thrown value", () => {
    expect(errorMessage("oops")).toEqual({ message: "Unknown error", status: null });
    expect(errorMessage(undefined)).toEqual({ message: "Unknown error", status: null });
    expect(errorMessage(42)).toEqual({ message: "Unknown error", status: null });
  });

  it("preserves the API error's synthesized message when body is empty", () => {
    const err = new GroundStationApiError(503, "");
    const result = errorMessage(err);
    expect(result.message).toBe("Ground station API 503: ");
    expect(result.status).toBe(503);
  });

  it("prefers the parsed detail over the API error's synthesized message", () => {
    const err = new GroundStationApiError(
      422,
      JSON.stringify({ detail: "Invalid PIC token" }),
      "synthesized fallback",
    );
    const result = errorMessage(err);
    expect(result.message).toBe("Invalid PIC token");
    expect(result.status).toBe(422);
  });

  it("handles a JSON body that is neither detail nor message by returning the raw body", () => {
    const err = new GroundStationApiError(400, JSON.stringify({ code: "X" }));
    const result = errorMessage(err);
    expect(result.message).toBe(JSON.stringify({ code: "X" }));
    expect(result.status).toBe(400);
  });
});
