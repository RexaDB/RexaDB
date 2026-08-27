"use client";

import { useCallback, useState } from "react";
import type { Task, TaskStatus } from "@/lib/ai/task-types";

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

export function useTaskHarness(initial?: Task[]) {
  const [tasks, setTasks] = useState<Task[]>(initial || []);

  const addTasks = useCallback((next: Omit<Task, "id">[] | Task[]) => {
    const now = Date.now();
    const toAdd: Task[] = next.map((t: any, i) => ({
      id: (t as Task).id || `task-${now}-${i}-${randomId()}`,
      label: String(t.label || t.title || "Untitled task"),
      amount: t.amount ? String(t.amount) : undefined,
      status: (t.status as TaskStatus) || "pending",
      details: Array.isArray(t.details)
        ? t.details.map((d: any) => ({
            label: String(d.label || ""),
            meta: d.meta != null ? String(d.meta) : "",
          }))
        : undefined,
      createdAt: now,
      updatedAt: now,
    }));
    setTasks((prev) => [...prev, ...toAdd]);
    return toAdd;
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)));
  }, []);

  const setTaskStatus = useCallback((id: string, status: TaskStatus) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status, updatedAt: Date.now() } : t)));
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearTasks = useCallback(() => setTasks([]), []);

  const retryTask = useCallback((id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id && t.status === "failed" ? { ...t, status: "pending" as TaskStatus, updatedAt: Date.now() } : t)));
    // Simulate retry → pending → completed after delay (harness can override)
    setTimeout(() => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: "completed" as TaskStatus, updatedAt: Date.now() } : t)));
    }, 1400);
  }, []);

  return {
    tasks,
    setTasks,
    addTasks,
    updateTask,
    setTaskStatus,
    removeTask,
    clearTasks,
    retryTask,
  };
}
