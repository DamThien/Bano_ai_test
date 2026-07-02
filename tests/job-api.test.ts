import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AiClient } from "../src/ai-client.js";
import { createApp } from "../src/app.js";
import type { AppLogger } from "../src/logger.js";
import type { AnalysisResult } from "../src/types.js";

class StubAiClient implements AiClient {
  calls = 0;

  constructor(
    private readonly handler: (text: string) => Promise<AnalysisResult>,
  ) {}

  async analyze(text: string): Promise<AnalysisResult> {
    this.calls += 1;
    return this.handler(text);
  }
}

class RecordingLogger implements AppLogger {
  entries: Array<{ level: "info" | "error"; message: string; metadata?: unknown }> = [];

  info(message: string, metadata?: Record<string, unknown>) {
    this.entries.push({ level: "info", message, metadata });
  }

  error(message: string, metadata?: Record<string, unknown>) {
    this.entries.push({ level: "error", message, metadata });
  }
}

async function waitForTerminalStatus(app: ReturnType<typeof createApp>, id: string) {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    const response = await request(app).get(`/v1/analysis-jobs/${id}`);
    if (["completed", "failed"].includes(response.body.status)) return response;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Job did not reach a terminal status");
}

describe("analysis jobs API", () => {
  it("creates and completes a valid analysis job", async () => {
    const aiClient = new StubAiClient(async () => ({
      label: "normal",
      confidence: 0.9,
    }));
    const app = createApp({ aiClient, logger: new RecordingLogger() });

    const created = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "valid-request-1")
      .send({ userId: "user-1", text: "A valid input" });

    expect(created.status).toBe(202);
    const completed = await waitForTerminalStatus(app, created.body.id);
    expect(completed.body.status).toBe("completed");
    expect(completed.body.result.label).toBe("normal");
  });

  it("rejects an invalid payload with a stable error code", async () => {
    const aiClient = new StubAiClient(async () => ({
      label: "normal",
      confidence: 0.9,
    }));
    const app = createApp({ aiClient, logger: new RecordingLogger() });

    const response = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "invalid-request-1")
      .send({ userId: "", text: "" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "INVALID_REQUEST" });
    expect(aiClient.calls).toBe(0);
  });

  it("returns the same job for a repeated idempotency key", async () => {
    const aiClient = new StubAiClient(async () => ({
      label: "normal",
      confidence: 0.9,
    }));
    const app = createApp({ aiClient, logger: new RecordingLogger() });
    const payload = { userId: "user-1", text: "Do not process twice" };

    const first = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "same-key")
      .send(payload);
    const second = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "same-key")
      .send(payload);

    expect(second.status).toBe(202);
    expect(second.body.id).toBe(first.body.id);
    await waitForTerminalStatus(app, first.body.id);
    expect(aiClient.calls).toBe(1);
  });

  it("does not expose the provider error to the client", async () => {
    const aiClient = new StubAiClient(async () => {
      throw new Error("provider api key sk-secret-value is invalid");
    });
    const app = createApp({ aiClient, logger: new RecordingLogger() });

    const created = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "provider-error-1")
      .send({ userId: "user-1", text: "Sensitive user text" });

    const failed = await waitForTerminalStatus(app, created.body.id);
    expect(failed.body.status).toBe("failed");
    expect(failed.body.error).toBe("AI_PROCESSING_FAILED");
    expect(JSON.stringify(failed.body)).not.toContain("sk-secret-value");
  });
});
