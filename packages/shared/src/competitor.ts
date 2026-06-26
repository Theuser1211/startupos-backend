export interface CompetitorData {
  id: string;
  name: string;
  website: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  latestSnapshot: CompetitorSnapshotData | null;
  changes: CompetitorChangeData[];
}

export interface AddCompetitorPayload {
  name: string;
  website: string;
  description?: string;
}

export interface CompetitorSnapshotData {
  id: string;
  title: string;
  summary: string | null;
  pricing: string | null;
  features: unknown;
  rawContent: string | null;
  capturedAt: string;
}

export interface CompetitorChangeData {
  id: string;
  type: string;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
}

export interface CompetitorHistoryData {
  competitor: CompetitorData;
  snapshots: CompetitorSnapshotData[];
  changes: CompetitorChangeData[];
}
