import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { ok, fail } from "./ai-shared";

// In-memory task store for the harness (per-request, not persisted)
// The client will handle rendering via markdown blocks, but these tools
// allow the AI to explicitly manage tasks via tool calls.

type TaskToolContext = {
  emitStep?: (message: string) => void;
  // Optional client-side task store setter (injected via context)
  getTasks?: () => any[];
  setTasks?: (tasks: any[]) => void;
};

export function createTaskTools(context: TaskToolContext = {}) {
  return {
    create_tasks: createTool({
      id: "create_tasks",
      description:
        "Create a list of tasks to track multi-step work. Use this when breaking down a request into steps, or when the user asks to create tasks/todos. Each task should have a label, optional amount, and optional details. Tasks will be displayed with the TaskRows UI.",
      inputSchema: z.object({
        tasks: z.array(
          z.object({
            label: z.string().min(1).describe("Task title, e.g. 'Verified vendor records'"),
            amount: z.string().optional().describe("Amount suffix, e.g. '12 suppliers' or '7 SKUs'"),
            status: z.enum(["pending", "in_progress", "completed", "failed"]).optional().describe("Initial status, defaults to pending"),
            details: z
              .array(
                z.object({
                  label: z.string().min(1),
                  meta: z.string().optional(),
                }),
              )
              .optional()
              .describe("Expandable detail rows"),
          }),
        ),
        variant: z.enum(["Capsules", "List"]).optional().describe("UI variant, defaults to Capsules"),
      }),
      outputSchema: z.object({
        ok: z.boolean(),
        data: z.any().nullable(),
        error: z.string().nullable(),
      }),
      execute: async ({ tasks, variant }) => {
        try {
          context.emitStep?.(`Creating ${tasks.length} tasks`);
          const normalized = tasks.map((t, i) => ({
            id: `task-${Date.now()}-${i}`,
            label: t.label,
            amount: t.amount,
            status: t.status || "pending",
            details: t.details,
            createdAt: Date.now(),
          }));
          // If harness provided a setter, update it; otherwise just return
          if (context.setTasks && context.getTasks) {
            const current = context.getTasks() || [];
            context.setTasks([...current, ...normalized]);
          }
          return ok({ tasks: normalized, variant: variant || "Capsules" });
        } catch (e) {
          return fail(e);
        }
      },
    }),

    update_task: createTool({
      id: "update_task",
      description: "Update a task's status or details. Use to mark tasks as in_progress, completed, or failed, or to add detail rows.",
      inputSchema: z.object({
        taskId: z.string().describe("ID of the task to update (from create_tasks result)"),
        status: z.enum(["pending", "in_progress", "completed", "failed"]).optional(),
        label: z.string().optional(),
        amount: z.string().optional(),
        details: z
          .array(
            z.object({
              label: z.string(),
              meta: z.string().optional(),
            }),
          )
          .optional(),
      }),
      outputSchema: z.object({
        ok: z.boolean(),
        data: z.any().nullable(),
        error: z.string().nullable(),
      }),
      execute: async ({ taskId, status, label, amount, details }) => {
        try {
          context.emitStep?.(`Updating task ${taskId} → ${status || "details"}`);
          if (context.getTasks && context.setTasks) {
            const current = context.getTasks() || [];
            const updated = current.map((t: any) =>
              t.id === taskId ? { ...t, ...(status ? { status } : {}), ...(label ? { label } : {}), ...(amount ? { amount } : {}), ...(details ? { details } : {}), updatedAt: Date.now() } : t,
            );
            context.setTasks(updated);
            return ok({ taskId, status, updated });
          }
          return ok({ taskId, status });
        } catch (e) {
          return fail(e);
        }
      },
    }),

    list_tasks: createTool({
      id: "list_tasks",
      description: "List current tasks and their statuses.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        ok: z.boolean(),
        data: z.any().nullable(),
        error: z.string().nullable(),
      }),
      execute: async () => {
        try {
          const tasks = context.getTasks?.() || [];
          return ok({ tasks, count: tasks.length });
        } catch (e) {
          return fail(e);
        }
      },
    }),
  };
}
