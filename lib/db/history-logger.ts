interface HistoryLogEntry {
  timestamp: number;
  operation: "load" | "save" | "add" | "clear" | "error";
  connectionId: number;
  historyCount?: number;
  details?: any;
  error?: string;
}

class HistoryLogger {
  private logs: HistoryLogEntry[] = [];
  private maxLogs = 1000;

  async loadExistingLogs() {}
  private async writeToFile() {}

  log(entry: Omit<HistoryLogEntry, "timestamp">) {
    this.logs.push({ ...entry, timestamp: Date.now() });
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  getLogs() {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
  }
}

const historyLogger = new HistoryLogger();

export async function logHistoryOperation(
  operation: HistoryLogEntry["operation"],
  connectionId: number,
  payload?: number | { historyCount?: number; firstEntry?: string; lastEntry?: string; operation?: string; error?: string; savedCount?: number; success?: boolean; inputCount?: number }
) {
  if (typeof payload === 'number' || payload === undefined) {
    historyLogger.log({ operation, connectionId, historyCount: payload as number | undefined });
  } else {
    historyLogger.log({ operation, connectionId, ...payload as any });
  }
}
