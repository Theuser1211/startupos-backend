export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  result?: unknown;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobResponse {
  job: Job;
}
