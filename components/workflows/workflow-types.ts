export type WorkflowRow = {
  id: string;
  connectionId?: number | null;
  name: string;
  description: string | null;
  nodesJson: string;
  edgesJson?: string;
  scheduleEnabled: boolean | null;
  scheduleType: "cron" | "datetime" | null;
  scheduleValue: string | null;
  lastRunAt?: number | null;
  createdAt: number;
  updatedAt: number;
};
