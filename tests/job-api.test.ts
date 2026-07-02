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

  it("rejects a reused Idempotency-Key when the payload differs", async () => {
    const aiClient = new StubAiClient(async () => ({
      label: "normal",
      confidence: 0.9,
    }));
    const app = createApp({ aiClient, logger: new RecordingLogger() });

    const first = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "conflict-key")
      .send({ userId: "user-1", text: "First payload" });
    expect(first.status).toBe(202);

    const second = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "conflict-key")
      .send({ userId: "user-1", text: "Different payload" });

    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "IDEMPOTENCY_KEY_CONFLICT" });
  });

  it("rejects a request missing the Idempotency-Key header", async () => {
    const aiClient = new StubAiClient(async () => ({
      label: "normal",
      confidence: 0.9,
    }));
    const app = createApp({ aiClient, logger: new RecordingLogger() });

    const response = await request(app)
      .post("/v1/analysis-jobs")
      .send({ userId: "user-1", text: "No header sent" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "INVALID_REQUEST" });
    expect(aiClient.calls).toBe(0);
  });

  it("fails the job instead of leaving it stuck in processing when the AI provider hangs", async () => {
    const aiClient = new StubAiClient(() => new Promise(() => {}));
    const app = createApp({
      aiClient,
      logger: new RecordingLogger(),
      aiTimeoutMs: 50,
    });

    const created = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "timeout-1")
      .send({ userId: "user-1", text: "This call never resolves" });

    const failed = await waitForTerminalStatus(app, created.body.id);
    expect(failed.body.status).toBe("failed");
    expect(failed.body.error).toBe("AI_PROCESSING_FAILED");
  });

  it("never writes the raw user text to the logs", async () => {
    const aiClient = new StubAiClient(async () => ({
      label: "normal",
      confidence: 0.9,
    }));
    const logger = new RecordingLogger();
    const app = createApp({ aiClient, logger });
    const secretText = "super secret user content, do not log me";

    const created = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "log-check-1")
      .send({ userId: "user-1", text: secretText });

    await waitForTerminalStatus(app, created.body.id);

    const serializedLogs = JSON.stringify(logger.entries);
    expect(serializedLogs).not.toContain(secretText);
  });

  it("returns 404 for a job id that does not exist", async () => {
    const aiClient = new StubAiClient(async () => ({
      label: "normal",
      confidence: 0.9,
    }));
    const app = createApp({ aiClient, logger: new RecordingLogger() });

    const response = await request(app).get(
      "/v1/analysis-jobs/00000000-0000-0000-0000-000000000000",
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "JOB_NOT_FOUND" });
  });

  it("accepts userId and text at exactly the maximum allowed length", async () => {
    const aiClient = new StubAiClient(async () => ({
      label: "normal",
      confidence: 0.9,
    }));
    const app = createApp({ aiClient, logger: new RecordingLogger() });

    const response = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "boundary-ok")
      .send({ userId: "u".repeat(100), text: "t".repeat(2000) });

    expect(response.status).toBe(202);
  });

  it("rejects userId and text that exceed the maximum allowed length", async () => {
    const aiClient = new StubAiClient(async () => ({
      label: "normal",
      confidence: 0.9,
    }));
    const app = createApp({ aiClient, logger: new RecordingLogger() });

    const tooLongUserId = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "boundary-userid-fail")
      .send({ userId: "u".repeat(101), text: "valid text" });
    expect(tooLongUserId.status).toBe(400);
    expect(tooLongUserId.body).toEqual({ error: "INVALID_REQUEST" });

    const tooLongText = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "boundary-text-fail")
      .send({ userId: "user-1", text: "t".repeat(2001) });
    expect(tooLongText.status).toBe(400);
    expect(tooLongText.body).toEqual({ error: "INVALID_REQUEST" });

    expect(aiClient.calls).toBe(0);
  });

  it("rejects whitespace-only userId or text", async () => {
    const aiClient = new StubAiClient(async () => ({
      label: "normal",
      confidence: 0.9,
    }));
    const app = createApp({ aiClient, logger: new RecordingLogger() });

    const response = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "whitespace-only")
      .send({ userId: "   ", text: "   " });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "INVALID_REQUEST" });
    expect(aiClient.calls).toBe(0);
  });

  it("returns a stable error code for a malformed JSON body", async () => {
    const aiClient = new StubAiClient(async () => ({
      label: "normal",
      confidence: 0.9,
    }));
    const app = createApp({ aiClient, logger: new RecordingLogger() });

    const response = await request(app)
      .post("/v1/analysis-jobs")
      .set("Idempotency-Key", "malformed-json")
      .set("Content-Type", "application/json")
      .send("{ this is not valid json");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "INVALID_REQUEST" });
    expect(aiClient.calls).toBe(0);
  });
});
