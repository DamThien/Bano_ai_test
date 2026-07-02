import { randomUUID } from "node:crypto";
import type { AnalysisJob, AnalysisResult, JobStatus } from "./types.js";

interface StoredJob extends AnalysisJob {
  idempotencyKey: string;
  requestFingerprint: string;
}

export class JobStore {
  private readonly jobs = new Map<string, StoredJob>();
  private readonly idempotencyIndex = new Map<string, string>();

  createJob(params: {
    userId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  }): AnalysisJob {
    const now = new Date().toISOString();
    const job: StoredJob = {
      id: randomUUID(),
      userId: params.userId,
      status: "queued",
      idempotencyKey: params.idempotencyKey,
      requestFingerprint: params.requestFingerprint,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    this.idempotencyIndex.set(params.idempotencyKey, job.id);
    return this.toPublicJob(job);
  }

  findById(id: string): AnalysisJob | undefined {
    const job = this.jobs.get(id);
    return job ? this.toPublicJob(job) : undefined;
  }

  findByIdempotencyKey(
    key: string,
  ): { job: AnalysisJob; requestFingerprint: string } | undefined {
    const id = this.idempotencyIndex.get(key);
    const job = id ? this.jobs.get(id) : undefined;
    return job
      ? { job: this.toPublicJob(job), requestFingerprint: job.requestFingerprint }
      : undefined;
  }

  updateJob(
    id: string,
    patch: { status: JobStatus; result?: AnalysisResult; error?: string },
  ): AnalysisJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    const updated: StoredJob = {
      ...job,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(id, updated);
    return this.toPublicJob(updated);
  }

  private toPublicJob(job: StoredJob): AnalysisJob {
    const { idempotencyKey: _key, requestFingerprint: _fingerprint, ...publicJob } =
      job;
    return { ...publicJob };
  }
}
