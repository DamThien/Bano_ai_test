import express from "express";
import type { AiClient } from "./ai-client.js";
import { DemoAiClient } from "./ai-client.js";
import { IdempotencyConflictError, JobService } from "./job-service.js";
import { JobStore } from "./job-store.js";
import type { AppLogger } from "./logger.js";
import { consoleLogger } from "./logger.js";
import { validateAnalysisRequest } from "./validation.js";

export interface AppDependencies {
  aiClient?: AiClient;
  logger?: AppLogger;
  /** Exposed for tests so AI-provider timeout behaviour can run fast. */
  aiTimeoutMs?: number;
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  app.use(express.json());

  const service = new JobService(
    new JobStore(),
    dependencies.aiClient ?? new DemoAiClient(),
    dependencies.logger ?? consoleLogger,
    dependencies.aiTimeoutMs,
  );

  app.post("/v1/analysis-jobs", (request, response) => {
    const idempotencyKey = request.header("Idempotency-Key");
    const validation = validateAnalysisRequest(request.body, idempotencyKey);

    if (!validation.ok) {
      response.status(400).json({ error: "INVALID_REQUEST" });
      return;
    }

    try {
      const job = service.createJob(validation.input, validation.idempotencyKey);
      response.status(202).json(job);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        response.status(409).json({ error: "IDEMPOTENCY_KEY_CONFLICT" });
        return;
      }
      throw error;
    }
  });

  app.get("/v1/analysis-jobs/:id", (request, response) => {
    const job = service.getJob(request.params.id);
    if (!job) {
      response.status(404).json({ error: "JOB_NOT_FOUND" });
      return;
    }

    response.json(job);
  });

  // Malformed JSON bodies must not leak Express/body-parser internals to the
  // client - map them to the same stable INVALID_REQUEST contract.
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction,
    ) => {
      if (error instanceof SyntaxError) {
        response.status(400).json({ error: "INVALID_REQUEST" });
        return;
      }
      response.status(500).json({ error: "INTERNAL_ERROR" });
    },
  );

  return app;
}
