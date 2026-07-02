import { createHash } from "node:crypto";
import type { AiClient } from "./ai-client.js";
import type { AppLogger } from "./logger.js";
import { JobStore } from "./job-store.js";
import type { AnalysisInput, AnalysisJob } from "./types.js";

export class JobService {
  constructor(
    private readonly store: JobStore,
    private readonly aiClient: AiClient,
    private readonly logger: AppLogger,
  ) {}

  createJob(input: AnalysisInput, idempotencyKey: string): AnalysisJob {
    const requestFingerprint = createHash("sha256")
      .update(`${input.userId}\u0000${input.text}`)
      .digest("hex");

    const job = this.store.createJob({
      userId: input.userId,
      idempotencyKey,
      requestFingerprint,
    });

    this.logger.info("analysis_job_created", {
      jobId: job.id,
      userId: input.userId,
      text: input.text,
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
      const result = await this.aiClient.analyze(text);
      this.store.updateJob(jobId, { status: "completed", result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateJob(jobId, { status: "failed", error: message });
      this.logger.error("analysis_job_failed", { jobId, error: message });
    }
  }
}
