export interface DashboardData {
  startup: {
    id: string;
    name: string;
    industry: string | null;
  };
  healthScore: number;
  healthBreakdown: {
    foundational: number;
    product: number;
    launch: number;
    engagement: number;
  };
  history: {
    score: number;
    createdAt: string;
  }[];
  recentEvents: DashboardEvent[];
  topActions: DashboardAction[];
}

export interface DashboardEvent {
  id: string;
  type: string;
  metadata: unknown;
  createdAt: string;
}

export interface DashboardAction {
  id: string;
  action: string;
  description: string;
  priority: "high" | "medium" | "low";
  link: string | null;
  completed: boolean;
}
