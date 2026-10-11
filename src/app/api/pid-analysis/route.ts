/**
 * AI PID analysis endpoint.
 *
 * Accepts flight log analysis metrics and current PID parameters,
 * sends them to Groq for tuning recommendations, and returns
 * structured suggestions.
 *
 * @license GPL-3.0-only
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { fetchWithTimeout } from "@/lib/net/fetch-with-timeout";
import { checkLocalOnlyRoute } from "@/lib/server/local-only-route";
import { authCookieConfig } from "../auth/cookie-config";
import type {
  AiAnalysisRequest,
  AiAnalysisResponse,
  AiRecommendation,
} from "@/lib/analysis/types";
import { validateSuggestion } from "@/lib/analysis/pid-safety";
import type { TuningVehicleType } from "@/lib/analysis/types";

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-20b";
const GROQ_TIMEOUT_MS = 30_000;
/** Analysis metrics plus PID params are a few KB; refuse anything past this. */
const MAX_BODY_BYTES = 1024 * 1024;
const FEATURE = "pid_analysis";

const SYSTEM_PROMPT = `You are an expert ArduPilot PID tuning advisor. Given flight log analysis metrics and current PID parameters, provide tuning recommendations.

Rules:
- Only suggest parameters that need changing, and only parameters listed in currentParams
- Keep suggestions conservative (small increments)
- Prioritize stability over responsiveness
- If noise is high, suggest lowering D-term and adjusting filters first
- If tracking error is high, suggest increasing P-term carefully
- If overshoot is high, reduce P, increase D slightly
- Include confidence score 0-100 for each recommendation
- Group by priority: critical (safety/stability), important (performance), optional (polish)

Respond with valid JSON only. Format:
{
  "recommendations": [
    {
      "id": "rec-1",
      "title": "Short title",
      "explanation": "2-3 sentence explanation of why this change helps",
      "priority": "critical|important|optional",
      "confidence": 85,
      "parameters": [
        { "param": "ATC_RAT_RLL_P", "currentValue": 0.135, "suggestedValue": 0.12, "delta": -0.015 }
      ]
    }
  ],
  "summary": "One paragraph overall assessment"
}`;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidPriority(v: unknown): v is "critical" | "important" | "optional" {
  return v === "critical" || v === "important" || v === "optional";
}

function isValidRecommendation(r: unknown): r is AiRecommendation {
  if (!r || typeof r !== "object") return false;
  const obj = r as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.title === "string" &&
    typeof obj.explanation === "string" &&
    isValidPriority(obj.priority) &&
    typeof obj.confidence === "number" &&
    Array.isArray(obj.parameters) &&
    obj.parameters.every(
      (p: unknown) =>
        p &&
        typeof p === "object" &&
        typeof (p as Record<string, unknown>).param === "string" &&
        typeof (p as Record<string, unknown>).currentValue === "number" &&
        typeof (p as Record<string, unknown>).suggestedValue === "number" &&
        typeof (p as Record<string, unknown>).delta === "number",
    )
  );
}

function parseGroqResponse(text: string): AiAnalysisResponse {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  const parsed = JSON.parse(cleaned);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray(parsed.recommendations)
  ) {
    return {
      recommendations: [],
      summary: "",
      error: "AI returned unexpected response shape",
    };
  }

  const validRecs = parsed.recommendations.filter(isValidRecommendation);
  const summary = typeof parsed.summary === "string" ? parsed.summary : "";

  return { recommendations: validRecs, summary };
}

function isValidAnalysisRequest(v: unknown): v is AiAnalysisRequest {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  const vehicleTypes: TuningVehicleType[] = ["copter", "plane", "rover"];
  return (
    vehicleTypes.includes(obj.vehicleType as TuningVehicleType) &&
    !!obj.currentParams &&
    typeof obj.currentParams === "object" &&
    !Array.isArray(obj.currentParams) &&
    Object.values(obj.currentParams).every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/**
 * Check every suggested change against the safety ranges and the vehicle's
 * current values sent with the request. Unsafe or unknown params are dropped,
 * the rest are limited to the safe range and step, and a recommendation whose
 * suggestions were all dropped is removed.
 */
function enforceSafetyRanges(
  recs: AiRecommendation[],
  request: AiAnalysisRequest,
): AiRecommendation[] {
  const { vehicleType, currentParams } = request;
  return recs.flatMap((rec) => {
    const parameters = rec.parameters.flatMap((p) => {
      const current = Object.hasOwn(currentParams, p.param) ? currentParams[p.param] : undefined;
      const check = validateSuggestion(p.param, current, p.suggestedValue, vehicleType);
      if (check.status === "rejected" || current === undefined) return [];
      return [{ param: p.param, currentValue: current, suggestedValue: check.value, delta: check.value - current }];
    });
    if (rec.parameters.length > 0 && parameters.length === 0) return [];
    return [{ ...rec, parameters }];
  });
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function failure(error: string, status: number, extra: Partial<AiAnalysisResponse> = {}) {
  return NextResponse.json(
    { recommendations: [], summary: "", error, ...extra } satisfies AiAnalysisResponse,
    { status },
  );
}

/** Read and parse the JSON body under {@link MAX_BODY_BYTES}; null when over. */
async function readCappedJson(request: NextRequest): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) throw new Error("empty body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return failure("AI analysis requires GROQ_API_KEY. Set it as an environment variable.", 503);
  }

  // ── Auth gate ────────────────────────────────────────────────
  // Accounts and the weekly quota live in Convex. A self-hosted install
  // without a Convex deployment has neither, so there the operator's own
  // model key serves only callers on the operator's own network.
  const accountsEnabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  if (!accountsEnabled) {
    const refused = checkLocalOnlyRoute(request);
    if (refused) return refused;
  }
  const token = accountsEnabled
    ? (request.cookies.get(authCookieConfig(request).tokenName)?.value ?? null)
    : null;
  if (accountsEnabled && !token) {
    return failure("auth_required", 401);
  }

  // ── Body validation (before any quota or upstream work) ──────
  let body: AiAnalysisRequest;
  try {
    const parsedBody = await readCappedJson(request);
    if (parsedBody === null) return failure("Request body too large", 413);
    if (!isValidAnalysisRequest(parsedBody)) throw new Error("invalid request shape");
    body = parsedBody;
  } catch {
    return failure("Invalid request body", 400);
  }

  // ── Quota check (nothing is spent yet) ───────────────────────
  if (token) {
    let quota: { remaining: number; weeklyLimit: number } | null;
    try {
      quota = await fetchQuery(api.cmdAiUsage.getRemaining, { feature: FEATURE }, { token });
    } catch (err) {
      console.error("AI usage check failed:", err);
      return failure("Usage check failed. Please try again.", 500);
    }
    if (quota === null) return failure("auth_required", 401);
    if (quota.remaining <= 0) {
      return failure("weekly_limit_reached", 429, { remaining: 0, weeklyLimit: quota.weeklyLimit });
    }
  }

  let result: Pick<AiAnalysisResponse, "recommendations" | "summary">;
  try {
    const groqRes = await fetchWithTimeout(GROQ_API, {
      method: "POST",
      timeoutMs: GROQ_TIMEOUT_MS,
      upstreamSignal: request.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(body) },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });

    if (!groqRes.ok) {
      console.error("AI analysis upstream failed:", groqRes.status);
      await groqRes.body?.cancel().catch(() => undefined);
      return failure(`AI analysis failed with upstream status ${groqRes.status}`, 502);
    }

    const groqData = await groqRes.json();
    const content = groqData?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return failure("AI returned empty response", 502);
    }

    const parsed = parseGroqResponse(content);
    result = { ...parsed, recommendations: enforceSafetyRanges(parsed.recommendations, body) };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return failure("AI analysis timed out", 504);
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return failure(`AI analysis failed: ${message}`, 502);
  }

  // ── Record usage only for an answer actually delivered ───────
  let usage: { remaining: number; weeklyLimit: number } | null = null;
  if (token) {
    try {
      const recorded = await fetchMutation(
        api.cmdAiUsage.record,
        { feature: FEATURE },
        { token },
      );
      usage = { remaining: recorded.remaining, weeklyLimit: recorded.weeklyLimit };
    } catch (err) {
      // The answer is already computed; a failed tally does not withhold it.
      console.error("AI usage record failed:", err);
    }
  }
  return NextResponse.json({ ...result, ...usage });
}
