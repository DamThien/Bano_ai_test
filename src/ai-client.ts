import type { AnalysisResult } from "./types.js";

export interface AiClient {
  analyze(text: string): Promise<AnalysisResult>;
}

export class DemoAiClient implements AiClient {
  async analyze(text: string): Promise<AnalysisResult> {
    await new Promise((resolve) => setTimeout(resolve, 50));

    return {
      label: text.length > 80 ? "needs_attention" : "normal",
      confidence: 0.8,
    };
  }
}
