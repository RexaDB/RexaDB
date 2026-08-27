"use client";

import { useEffect, useState } from "react";
import type { Task } from "@/lib/ai/task-types";

/* ─────────────────────────────────────────────────────────
 * TASK ROWS — adapted from provided snippet
 *  - Capsules: floating cards (default)
 *  - List: inset list (for sidebar)
 *  Harness-driven: when tasks prop is provided, renders
 *  those tasks with live status. Otherwise runs demo ticks.
 *  Tokens mapped: --line→--border, --ink→--foreground, etc.
 * ───────────────────────────────────────────────────────── */

const TICKS = [600, 900, 2400, 1400, 2400, 600];

function useTick(intervals: number[]) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (tick >= intervals.length - 1) return;
    const t = setTimeout(() => setTick((x) => x + 1), intervals[tick]);
    return () => clearTimeout(t);
  }, [tick, intervals]);
  return tick;
}

function SpinnerRing({ active, children }: { active?: boolean; children?: React.ReactNode }) {
  const size = 24,
    stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0" style={active ? { animation: "spin 1.1s linear infinite" } : undefined}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {active && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * 0.28} ${c * 0.72}`}
          />
        )}
      </svg>
      <span className="relative text-[10.5px] font-semibold tabular-nums text-foreground">{children}</span>
    </span>
  );
}

function Badge({ tone, children }: { tone: "red" | "green"; children: React.ReactNode }) {
  return (
    <span
      className={`flex size-[22px] shrink-0 items-center justify-center rounded-full text-white ${tone === "red" ? "bg-destructive" : "bg-emerald-500"}`}
      style={{ animation: "pop-in 300ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      {children}
    </span>
  );
}

const XIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);
const CheckIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);
const RetryIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
  </svg>
);

type HarnessTaskProps = {
  tasks?: Task[];
  variant?: "Capsules" | "List";
  onToggle?: (id: string) => void;
  onRetry?: (id: string) => void;
};

function getStatusBadge(status: Task["status"], index: number) {
  if (status === "completed") return <Badge tone="green">{CheckIcon}</Badge>;
  if (status === "failed") return <Badge tone="red">{XIcon}</Badge>;
  if (status === "in_progress") return <SpinnerRing active>{index + 1}</SpinnerRing>;
  return <SpinnerRing>{index + 1}</SpinnerRing>;
}

function getStatusPill(status: Task["status"]) {
  if (status === "completed")
    return (
      <span className="inline-flex h-[22px] items-center rounded-full bg-emerald-500/10 px-2 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">Completed</span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-destructive/10 px-2 text-[11.5px] font-medium text-destructive" style={{ animation: "fade-in 200ms ease-out both" }}>
        Failed <span style={{ animation: "spin 1.2s linear infinite" }} className="flex">{RetryIcon}</span>
      </span>
    );
  if (status === "in_progress")
    return (
      <span className="inline-flex h-[22px] items-center rounded-full bg-amber-500/10 px-2 text-[11.5px] font-medium text-amber-600 dark:text-amber-400">In progress</span>
    );
  return null;
}

export default function TaskRows({ tasks: propTasks, variant = "Capsules", onToggle, onRetry }: HarnessTaskProps) {
  const tick = useTick(TICKS);
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  // Demo mode when no tasks provided
  if (!propTasks) {
    const row2: "pending" | "failed" | "done" = tick < 3 ? "pending" : tick === 3 ? "failed" : "done";
    const demoTasks: Array<{
      key: string;
      badge: React.ReactNode;
      label: string;
      amount: string;
      pill: React.ReactNode;
      details: Array<{ label: string; meta: string }>;
    }> = [
      {
        key: "verify",
        badge: <Badge tone="green">{CheckIcon}</Badge>,
        label: "Verified vendor records",
        amount: "12 suppliers",
        pill: <span className="inline-flex h-[22px] items-center rounded-full bg-emerald-500/10 px-2 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">Completed</span>,
        details: [
          { label: "Matched tax and contact IDs", meta: "12/12" },
          { label: "Flagged stale records", meta: "0" },
        ],
      },
      {
        key: "index",
        badge: <SpinnerRing active>2</SpinnerRing>,
        label: "Build reorder task list",
        amount: "7 SKUs",
        pill: null,
        details: [
          { label: "Reading POS export", meta: "3 files" },
          { label: "Scoring stockout risk", meta: "68%" },
        ],
      },
      {
        key: "draft",
        badge:
          row2 === "pending" ? (
            <SpinnerRing>3</SpinnerRing>
          ) : row2 === "failed" ? (
            <Badge tone="red">{XIcon}</Badge>
          ) : (
            <Badge tone="green">{CheckIcon}</Badge>
          ),
        label: "Draft supplier emails",
        amount: "2 messages",
        pill:
          row2 === "failed" ? (
            <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-destructive/10 px-2 text-[11.5px] font-medium text-destructive" style={{ animation: "fade-in 200ms ease-out both" }}>
              Failed <span style={{ animation: "spin 1.2s linear infinite" }} className="flex">{RetryIcon}</span>
            </span>
          ) : row2 === "done" ? (
            <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400" style={{ animation: "fade-in 200ms ease-out both" }}>
              Completed
            </span>
          ) : null,
        details: [
          { label: "Cone supplier follow-up", meta: "draft" },
          { label: "Pistachio reorder note", meta: "draft" },
        ],
      },
    ];

    const list = variant === "List";
    return (
      <div className={`flex w-full max-w-[440px] flex-col ${list ? "gap-0 self-start overflow-hidden rounded-xl bg-card shadow-sm border border-border" : "min-h-[196px] gap-2"}`}>
        {demoTasks.map((row, i) => {
          const open = manualOpen[row.key] ?? (row.key === "index" && tick === 2);
          return (
            <div
              key={row.key}
              className={`self-stretch overflow-hidden transition-[border-radius,background-color] duration-300 hover:bg-muted/50 ${list ? "border-b border-border last:border-0" : "bg-card shadow-sm border border-border"}`}
              style={{
                borderRadius: list ? 0 : open ? 14 : 22,
                animation: `fade-up 450ms cubic-bezier(0.23,1,0.32,1) ${i * 80}ms both`,
              }}
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setManualOpen((c) => ({ ...c, [row.key]: !open }))}
                className="flex h-11 w-full items-center gap-2.5 px-2.5 text-left"
              >
                <span className="flex size-6 shrink-0 items-center justify-center">{row.badge}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{row.label}</span>
                <span className="text-[12.5px] text-muted-foreground tabular-nums">{row.amount}</span>
                {row.pill}
                <span aria-hidden="true" className="-ml-2 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/70">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300" style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </button>
              <div className="grid transition-[grid-template-rows,opacity] duration-300" style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0, transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}>
                <div className="overflow-hidden">
                  <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
                    <span aria-hidden className="mx-auto h-full w-px bg-border" />
                    <div className="flex flex-col gap-1.5">
                      {row.details.map((d, j) => (
                        <div key={d.label} className="flex items-center justify-between" style={open ? { animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${120 + j * 100}ms both` } : undefined}>
                          <span className="text-[12px] text-muted-foreground">{d.label}</span>
                          <span className="font-mono text-[11.5px] text-muted-foreground/70 tabular-nums">{d.meta}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pop-in { 0% { transform: scale(0.8); opacity:0; } 100% { transform: scale(1); opacity:1; } } @keyframes fade-in { from { opacity:0; } to { opacity:1; } } @keyframes fade-up { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform: translateY(0); } }`}</style>
      </div>
    );
  }

  // Harness mode — real tasks
  const list = variant === "List";
  return (
    <div className={`flex w-full max-w-[440px] flex-col ${list ? "gap-0 self-start overflow-hidden rounded-xl bg-card shadow-sm border border-border" : "min-h-[80px] gap-2"}`}>
      {propTasks.map((task, i) => {
        const isOpen = manualOpen[task.id] ?? false;
        const badge = getStatusBadge(task.status, i);
        const pill = getStatusPill(task.status);
        const isClickable = !!task.details?.length;
        return (
          <div
            key={task.id}
            className={`self-stretch overflow-hidden transition-[border-radius,background-color] duration-300 ${isClickable ? "hover:bg-muted/50" : ""} ${list ? "border-b border-border last:border-0" : "bg-card shadow-sm border border-border"}`}
            style={{
              borderRadius: list ? 0 : isOpen ? 14 : 22,
              animation: `fade-up 450ms cubic-bezier(0.23,1,0.32,1) ${i * 80}ms both`,
            }}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              disabled={!isClickable}
              onClick={() => {
                if (!isClickable) return;
                const next = !isOpen;
                setManualOpen((c) => ({ ...c, [task.id]: next }));
                onToggle?.(task.id);
              }}
              className={`flex h-11 w-full items-center gap-2.5 px-2.5 text-left ${!isClickable ? "cursor-default" : ""}`}
            >
              <span className="flex size-6 shrink-0 items-center justify-center">{badge}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{task.label}</span>
              {task.amount && <span className="text-[12.5px] text-muted-foreground tabular-nums">{task.amount}</span>}
              {pill}
              {task.status === "failed" && onRetry ? (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry(task.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRetry(task.id);
                    }
                  }}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted ml-1"
                >
                  {RetryIcon}
                </span>
              ) : null}
              {isClickable && (
                <span aria-hidden="true" className={`${task.status === "failed" && onRetry ? "-ml-1" : "-ml-2"} flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/70`}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              )}
            </button>
            {isClickable && (
              <div className="grid transition-[grid-template-rows,opacity] duration-300" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr", opacity: isOpen ? 1 : 0, transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}>
                <div className="overflow-hidden">
                  <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
                    <span aria-hidden className="mx-auto h-full w-px bg-border" />
                    <div className="flex flex-col gap-1.5">
                      {task.details?.map((d, j) => (
                        <div key={`${d.label}-${j}`} className="flex items-center justify-between" style={isOpen ? { animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${120 + j * 100}ms both` } : undefined}>
                          <span className="text-[12px] text-muted-foreground">{d.label}</span>
                          <span className="font-mono text-[11.5px] text-muted-foreground/70 tabular-nums">{d.meta}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pop-in { 0% { transform: scale(0.8); opacity:0; } 100% { transform: scale(1); opacity:1; } } @keyframes fade-in { from { opacity:0; } to { opacity:1; } } @keyframes fade-up { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform: translateY(0); } }`}</style>
    </div>
  );
}
