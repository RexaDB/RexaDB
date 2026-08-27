type PendingApproval = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  questions: any[];
  createdAt: number;
};

const pending = new Map<string, PendingApproval>();

export function createPendingApproval(id: string, questions: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, questions, createdAt: Date.now() });
    // Auto-expire after 5 minutes
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Approval timed out"));
      }
    }, 5 * 60 * 1000);
  });
}

export function resolvePendingApproval(id: string, answers: any): boolean {
  let entry = pending.get(id);
  let key = id;
  if (!entry && pending.size > 0) {
    // Fallback: if exact ID not found (e.g. Pi vs Mastra ID mismatch), resolve the most recent pending
    // This handles cases where the client and server generate different IDs for the same logical approval
    const lastKey = Array.from(pending.keys()).pop();
    if (lastKey) {
      entry = pending.get(lastKey) || null;
      key = lastKey as string;
    }
  }
  if (!entry) return false;
  pending.delete(key);
  entry.resolve(answers);
  return true;
}

export function rejectPendingApproval(id: string, reason?: any): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  entry.reject(reason || new Error("Approval rejected"));
  return true;
}

export function getPendingApproval(id: string) {
  return pending.get(id) || null;
}

export function hasPendingApproval(id: string): boolean {
  return pending.has(id);
}
