import type { AnalysisInput } from "./types.js";

const MAX_USER_ID_LENGTH = 100;
const MAX_TEXT_LENGTH = 2000;

export type ValidatedRequest =
  | { ok: true; input: AnalysisInput; idempotencyKey: string }
  | { ok: false };

/**
 * Validates the raw request body and Idempotency-Key header for
 * POST /v1/analysis-jobs. Returns a discriminated union so callers never
 * have to guess which field failed - any failure maps to the single
 * stable INVALID_REQUEST error code required by the spec.
 */
export function validateAnalysisRequest(
  body: unknown,
  idempotencyKeyHeader: string | undefined,
): ValidatedRequest {
  if (
    typeof idempotencyKeyHeader !== "string" ||
    idempotencyKeyHeader.trim().length === 0
  ) {
    return { ok: false };
  }

  if (typeof body !== "object" || body === null) {
    return { ok: false };
  }

  const { userId, text } = body as Record<string, unknown>;

  if (
    typeof userId !== "string" ||
    userId.trim().length === 0 ||
    userId.length > MAX_USER_ID_LENGTH
  ) {
    return { ok: false };
  }

  if (
    typeof text !== "string" ||
    text.trim().length === 0 ||
    text.length > MAX_TEXT_LENGTH
  ) {
    return { ok: false };
  }

  return { ok: true, input: { userId, text }, idempotencyKey: idempotencyKeyHeader };
}
