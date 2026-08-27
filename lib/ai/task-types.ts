export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

export type TaskDetail = {
  label: string;
  meta?: string;
};

export type Task = {
  id: string;
  label: string;
  amount?: string;
  status: TaskStatus;
  details?: TaskDetail[];
  createdAt?: number;
  updatedAt?: number;
};

export type TaskBlock = {
  variant?: "Capsules" | "List";
  tasks: Task[];
};

export function normalizeTaskStatus(value: unknown): TaskStatus {
  const s = String(value || "").toLowerCase().trim();
  if (s === "completed" || s === "done" || s === "success") return "completed";
  if (s === "failed" || s === "error" || s === "failure") return "failed";
  if (s === "in_progress" || s === "inprogress" || s === "running" || s === "active" || s === "pending_active") return "in_progress";
  return "pending";
}
