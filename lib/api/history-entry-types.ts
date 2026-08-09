export interface HistoryEntry {
  id: string;
  query: string;
  executedAt: number;
  duration: number;
  status: "success" | "error";
  error?: string | null;
  rowsCount?: number | null;
  caller: "user" | "system";
  executedBy?: string | null;
  executedByName?: string | null;
}
