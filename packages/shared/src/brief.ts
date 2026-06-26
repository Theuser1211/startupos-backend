export interface DailyBriefData {
  id: string;
  summary: string;
  wins: string[];
  priorities: string[];
  competitorUpdates: string[];
  healthScore: number;
  healthHistory: { score: number; createdAt: string }[];
  generatedAt: string;
}
