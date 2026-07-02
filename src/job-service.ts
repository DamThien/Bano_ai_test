import { createHash } from "node:crypto";
import type { AiClient } from "./ai-client.js";
import type { AppLogger } from "./logger.js";
import { JobStore } from "./job-store.js";
import type { AnalysisInput, AnalysisJob } from "./types.js";

const DEFAULT_AI_TIMEOUT_MS = 5_000;

/** Thrown when an Idempotency-Key is reused with a different payload. */
export class IdempotencyConflictError extends Error {
  constructor() {
    super("IDEMPOTENCY_KEY_CONFLICT");
    this.name = "IdempotencyConflictError";
  }
}

export class JobService {
  constructor(
    private readonly store: JobStore,
    private readonly aiClient: AiClient,
    private readonly logger: AppLogger,
    private readonly aiTimeoutMs: number = DEFAULT_AI_TIMEOUT_MS,
  ) {}

  createJob(input: AnalysisInput, idempotencyKey: string): AnalysisJob {
    const requestFingerprint = this.fingerprint(input);

    // Idempotency: same key + same payload -> return the existing job and
    // never touch the AI provider again. Same key + different payload -> 409.
    const existing = this.store.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new IdempotencyConflictError();
      }
      return existing.job;
    }

    const job = this.store.createJob({
      userId: input.userId,
      idempotencyKey,
      requestFingerprint,
    });

    // Never log raw user text - only non-sensitive metadata.
    this.logger.info("analysis_job_created", {
      jobId: job.id,
      userId: input.userId,
      textLength: input.text.length,
    });

    void this.processJob(job.id, input.text);
    return job;
  }

  getJob(id: string): AnalysisJob | undefined {
    return this.store.findById(id);
  }

  private async processJob(jobId: string, text: string): Promise<void> {
    this.store.updateJob(jobId, { status: "processing" });

    try {
      const result = await this.withTimeout(
        this.aiClient.analyze(text),
        this.aiTimeoutMs,
      );
      this.store.updateJob(jobId, { status: "completed", result });
    } catch (error) {
      const internalReason = error instanceof Error ? error.message : String(error);

      // Client/API-facing error is always a stable, generic code so we never
      // leak provider internals (messages, keys, stack traces, etc).
      this.store.updateJob(jobId, {
        status: "failed",
        error: "AI_PROCESSING_FAILED",
      });

      // Full reason is fine in server-side logs (never sent to the client),
      // but we still keep the user's raw text out of it.
      this.logger.error("analysis_job_failed", { jobId, reason: internalReason });
    }
  }

  /** Guarantees a job never stays "processing" forever if the provider hangs. */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("AI_PROVIDER_TIMEOUT"));
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private fingerprint(input: AnalysisInput): string {
    return createHash("sha256")
      .update(`${input.userId}\u0000${input.text}`)
      .digest("hex");
  }
}
