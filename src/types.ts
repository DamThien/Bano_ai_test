export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface AnalysisInput {
  userId: string;
  text: string;
}

export interface AnalysisResult {
  label: string;
  confidence: number;
}

export interface AnalysisJob {
  id: string;
  userId: string;
  status: JobStatus;
  result?: AnalysisResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
