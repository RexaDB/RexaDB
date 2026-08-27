import { extractCodeBlock } from "@/lib/ai/chat-blocks";
import type { Task, TaskBlock } from "@/lib/ai/task-types";
import { normalizeTaskStatus } from "@/lib/ai/task-types";

export function parseTaskBlock(source: string): TaskBlock | null {
  const raw =
    extractCodeBlock(source, "tasks") ||
    extractCodeBlock(source, "task") ||
    extractCodeBlock(source, "task-rows") ||
    extractCodeBlock(source, "task_rows");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Allow { tasks: [...] } or [...] directly
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.tasks) ? parsed.tasks : null;
    if (!arr) return null;
    const tasks: Task[] = arr
      .map((t: any, idx: number) => {
        if (!t || typeof t !== "object") return null;
        const label = String(t.label || t.title || t.name || "").trim();
        if (!label) return null;
        return {
          id: String(t.id || t.key || `task-${idx}`),
          label,
          amount: t.amount != null ? String(t.amount) : undefined,
          status: normalizeTaskStatus(t.status),
          details: Array.isArray(t.details)
            ? t.details
                .map((d: any) => {
                  if (!d || typeof d !== "object") {
                    if (typeof d === "string") return { label: d, meta: "" };
                    return null;
                  }
                  const dl = String(d.label || d.title || "").trim();
                  if (!dl) return null;
                  return { label: dl, meta: d.meta != null ? String(d.meta) : "" };
                })
                .filter(Boolean) as Task["details"]
            : undefined,
          createdAt: typeof t.createdAt === "number" ? t.createdAt : undefined,
          updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : undefined,
        } as Task;
      })
      .filter(Boolean) as Task[];
    if (tasks.length === 0) return null;
    const variant = parsed.variant === "List" || parsed.variant === "list" ? "List" : "Capsules";
    return { variant, tasks };
  } catch {
    return null;
  }
}

// Also support parsing tasks from streaming content that contains multiple blocks
export function extractAllTaskBlocks(source: string): TaskBlock[] {
  const blocks: TaskBlock[] = [];
  const re = /```(?:tasks|task|task-rows|task_rows)\s*([\s\S]*?)\s*```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const b = parseTaskBlock(m[0]);
    if (b) blocks.push(b);
  }
  return blocks;
}
