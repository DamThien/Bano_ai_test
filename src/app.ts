import express from "express";
import type { AiClient } from "./ai-client.js";
import { DemoAiClient } from "./ai-client.js";
import { JobService } from "./job-service.js";
import { JobStore } from "./job-store.js";
import type { AppLogger } from "./logger.js";
import { consoleLogger } from "./logger.js";

export interface AppDependencies {
  aiClient?: AiClient;
  logger?: AppLogger;
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  app.use(express.json());

  const service = new JobService(
    new JobStore(),
    dependencies.aiClient ?? new DemoAiClient(),
    dependencies.logger ?? consoleLogger,
  );

  app.post("/v1/analysis-jobs", (request, response) => {
    const { userId, text } = request.body ?? {};
    const idempotencyKey = request.header("Idempotency-Key") ?? "missing-key";

    const job = service.createJob({ userId, text }, idempotencyKey);
    response.status(202).json(job);
  });

  app.get("/v1/analysis-jobs/:id", (request, response) => {
    const job = service.getJob(request.params.id);
    if (!job) {
      response.status(404).json({ error: "JOB_NOT_FOUND" });
      return;
    }

    response.json(job);
  });

  return app;
}
