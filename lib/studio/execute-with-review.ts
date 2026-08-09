export function generateActionId(): string {
  return Math.random().toString(36).substring(2, 9);
}

type AsyncQueryFn = (...args: any[]) => Promise<{ success: boolean; error?: string; data?: { executionTime?: number } }>;

export async function executeSqlWithHistory(
  queryFn: AsyncQueryFn,
  currentConnectionString: string,
  sql: string,
  addHistoryEntry: (entry: any) => void,
): Promise<{ success: boolean; error?: string }> {
  const startTime = Date.now();
  const res = await queryFn(currentConnectionString, sql);
  addHistoryEntry({
    query: sql,
    duration: res.data?.executionTime || (Date.now() - startTime),
    status: res.success ? "success" : "error",
    error: res.error,
    caller: "user",
  });
  return { success: res.success, error: res.error };
}
