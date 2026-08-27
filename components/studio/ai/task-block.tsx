"use client";

import TaskRows from "@/components/studio/ai/task-rows";
import type { Task } from "@/lib/ai/task-types";
import { useTaskHarness } from "@/hooks/use-task-harness";

export function TaskBlock({
  tasks: initialTasks,
  variant = "Capsules",
}: {
  tasks: Task[];
  variant?: "Capsules" | "List";
}) {
  const { tasks, retryTask } = useTaskHarness(initialTasks);

  return (
    <div className="my-3">
      <TaskRows tasks={tasks} variant={variant} onRetry={retryTask} />
    </div>
  );
}

// For harness-driven tasks where the harness manages the list externally
export function TaskBlockControlled({
  tasks,
  variant = "Capsules",
  onRetry,
}: {
  tasks: Task[];
  variant?: "Capsules" | "List";
  onRetry?: (id: string) => void;
}) {
  return (
    <div className="my-3">
      <TaskRows tasks={tasks} variant={variant} onRetry={onRetry} />
    </div>
  );
}
