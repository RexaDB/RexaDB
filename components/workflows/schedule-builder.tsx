"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ScheduleType = "cron" | "datetime";

export type ScheduleFrequency =
  | "once"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly";

const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function TimeSelects({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label>Hour</Label>
        <Select
          value={String(hour)}
          onValueChange={(v) => onHourChange(Number(v))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent onCloseAutoFocus={(e) => e.preventDefault()}>
            {Array.from({ length: 24 }, (_, i) => i).map((h) => (
              <SelectItem key={h} value={String(h)}>
                {pad2(h)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Minute</Label>
        <Select
          value={String(minute)}
          onValueChange={(v) => onMinuteChange(Number(v))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent onCloseAutoFocus={(e) => e.preventDefault()}>
            {MINUTE_OPTIONS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {pad2(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export type VisualSchedule = {
  frequency: ScheduleFrequency;
  /** 0–23 */
  hour: number;
  /** 0–59 */
  minute: number;
  /** 0=Sun … 6=Sat (weekly) */
  weekdays: number[];
  /** 1–31 (monthly) */
  dayOfMonth: number;
  /** datetime-local value when frequency is once */
  datetime: string;
};

const WEEKDAYS = [
  { value: 0, label: "S", full: "Sunday" },
  { value: 1, label: "M", full: "Monday" },
  { value: 2, label: "T", full: "Tuesday" },
  { value: 3, label: "W", full: "Wednesday" },
  { value: 4, label: "T", full: "Thursday" },
  { value: 5, label: "F", full: "Friday" },
  { value: 6, label: "S", full: "Saturday" },
] as const;

const FREQUENCIES: Array<{ id: ScheduleFrequency; label: string }> = [
  { id: "once", label: "Once" },
  { id: "hourly", label: "Hourly" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDatetimeLocal(date: Date, hour: number, minute: number): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(hour)}:${pad2(minute)}`;
}

function parseDatetimeLocal(value: string): Date | undefined {
  if (!value?.trim()) return undefined;
  // Prefer local parse for `YYYY-MM-DDTHH:mm`
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/,
  );
  if (match) {
    const [, y, mo, d, h, mi] = match.map(Number);
    const date = new Date(y, mo - 1, d, h, mi, 0, 0);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? undefined : fallback;
}

function defaultDatetimeLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60 - (d.getMinutes() % 60), 0, 0);
  return toDatetimeLocal(d, d.getHours(), d.getMinutes());
}

export function defaultVisualSchedule(): VisualSchedule {
  return {
    frequency: "daily",
    hour: 9,
    minute: 0,
    weekdays: [1],
    dayOfMonth: 1,
    datetime: defaultDatetimeLocal(),
  };
}

/** Best-effort parse of stored schedule into visual state. */
export function parseStoredSchedule(
  type: ScheduleType | null | undefined,
  value: string | null | undefined,
): VisualSchedule {
  const base = defaultVisualSchedule();
  if (!value?.trim()) return base;

  if (type === "datetime") {
    const parsed = parseDatetimeLocal(value);
    return {
      ...base,
      frequency: "once",
      datetime: value,
      hour: parsed?.getHours() ?? base.hour,
      minute: parsed?.getMinutes() ?? base.minute,
    };
  }

  const parts = value.trim().split(/\s+/);
  if (parts.length < 5) return base;
  const [minRaw, hourRaw, domRaw, , dowRaw] = parts;

  const minute = minRaw === "*" ? 0 : Number(minRaw);
  const hour = hourRaw === "*" ? 0 : Number(hourRaw);

  // Hourly: M * * * *
  if (hourRaw === "*" && domRaw === "*" && dowRaw === "*") {
    return {
      ...base,
      frequency: "hourly",
      minute: Number.isFinite(minute) ? minute : 0,
      hour: 0,
    };
  }

  // Daily: M H * * *
  if (domRaw === "*" && dowRaw === "*") {
    return {
      ...base,
      frequency: "daily",
      minute: Number.isFinite(minute) ? minute : 0,
      hour: Number.isFinite(hour) ? hour : 9,
    };
  }

  // Weekly: M H * * D[,D]
  if (domRaw === "*" && dowRaw !== "*") {
    const weekdays = dowRaw
      .split(",")
      .map((d) => Number(d))
      .filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
    return {
      ...base,
      frequency: "weekly",
      minute: Number.isFinite(minute) ? minute : 0,
      hour: Number.isFinite(hour) ? hour : 9,
      weekdays: weekdays.length ? weekdays : [1],
    };
  }

  // Monthly: M H D * *
  if (domRaw !== "*" && dowRaw === "*") {
    const dayOfMonth = Number(domRaw);
    return {
      ...base,
      frequency: "monthly",
      minute: Number.isFinite(minute) ? minute : 0,
      hour: Number.isFinite(hour) ? hour : 9,
      dayOfMonth:
        Number.isFinite(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31
          ? dayOfMonth
          : 1,
    };
  }

  return base;
}

export function visualToStored(schedule: VisualSchedule): {
  type: ScheduleType;
  value: string;
} {
  const m = schedule.minute;
  const h = schedule.hour;

  switch (schedule.frequency) {
    case "once":
      return { type: "datetime", value: schedule.datetime };
    case "hourly":
      return { type: "cron", value: `${m} * * * *` };
    case "daily":
      return { type: "cron", value: `${m} ${h} * * *` };
    case "weekly": {
      const days = [...schedule.weekdays].sort((a, b) => a - b);
      const dow = (days.length ? days : [1]).join(",");
      return { type: "cron", value: `${m} ${h} * * ${dow}` };
    }
    case "monthly":
      return {
        type: "cron",
        value: `${m} ${h} ${schedule.dayOfMonth} * *`,
      };
  }
}

export function describeVisualSchedule(schedule: VisualSchedule): string {
  const time = `${pad2(schedule.hour)}:${pad2(schedule.minute)}`;
  switch (schedule.frequency) {
    case "once": {
      const d = parseDatetimeLocal(schedule.datetime);
      return d
        ? `Once on ${format(d, "PPP")} at ${format(d, "HH:mm")}`
        : "Once";
    }
    case "hourly":
      return schedule.minute === 0
        ? "Every hour"
        : `Every hour at :${pad2(schedule.minute)}`;
    case "daily":
      return `Every day at ${time}`;
    case "weekly": {
      const names = WEEKDAYS.filter((d) => schedule.weekdays.includes(d.value))
        .map((d) => d.full.slice(0, 3))
        .join(", ");
      return `Weekly on ${names || "—"} at ${time}`;
    }
    case "monthly":
      return `Monthly on day ${schedule.dayOfMonth} at ${time}`;
  }
}

function validateVisual(schedule: VisualSchedule): string | null {
  if (schedule.frequency === "once") {
    if (!schedule.datetime.trim()) return "Pick a date and time";
    return null;
  }
  if (schedule.frequency === "weekly" && schedule.weekdays.length === 0) {
    return "Pick at least one weekday";
  }
  return null;
}

export { validateVisual };

type Props = {
  value: VisualSchedule;
  onChange: (next: VisualSchedule) => void;
};

export function ScheduleBuilder({ value, onChange }: Props) {
  const [dateOpen, setDateOpen] = useState(false);
  const summary = useMemo(() => describeVisualSchedule(value), [value]);
  const onceDate = useMemo(
    () => parseDatetimeLocal(value.datetime),
    [value.datetime],
  );

  function patch(partial: Partial<VisualSchedule>) {
    onChange({ ...value, ...partial });
  }

  function toggleWeekday(day: number) {
    const has = value.weekdays.includes(day);
    const weekdays = has
      ? value.weekdays.filter((d) => d !== day)
      : [...value.weekdays, day].sort((a, b) => a - b);
    patch({ weekdays });
  }

  function setOnceDate(date: Date | undefined) {
    if (!date) return;
    const hour = onceDate?.getHours() ?? value.hour;
    const minute = onceDate?.getMinutes() ?? value.minute;
    patch({
      datetime: toDatetimeLocal(date, hour, minute),
      hour,
      minute,
    });
    setDateOpen(false);
  }

  function setOnceTime(hour: number, minute: number) {
    const base = onceDate ?? new Date();
    patch({
      datetime: toDatetimeLocal(base, hour, minute),
      hour,
      minute,
    });
  }

  return (
    <div className="space-y-4">
      {/* Frequency */}
      <div className="space-y-1.5">
        <Label>Repeat</Label>
        <div className="grid grid-cols-5 gap-1 rounded-lg bg-muted/40 p-1">
          {FREQUENCIES.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => patch({ frequency: f.id })}
              className={cn(
                "rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors",
                value.frequency === f.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {value.frequency === "once" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !onceDate && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="size-4" />
                  {onceDate ? format(onceDate, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-auto p-0"
                align="start"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <Calendar
                  mode="single"
                  selected={onceDate}
                  onSelect={setOnceDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <TimeSelects
            hour={onceDate?.getHours() ?? value.hour}
            minute={onceDate?.getMinutes() ?? value.minute}
            onHourChange={(h) => setOnceTime(h, onceDate?.getMinutes() ?? value.minute)}
            onMinuteChange={(m) => setOnceTime(onceDate?.getHours() ?? value.hour, m)}
          />
        </div>
      ) : (
        <>
          {value.frequency === "weekly" && (
            <div className="space-y-1.5">
              <Label>Days</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => {
                  const active = value.weekdays.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      title={d.full}
                      onClick={() => toggleWeekday(d.value)}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full text-xs font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {value.frequency === "monthly" && (
            <div className="space-y-1.5">
              <Label>Day of month</Label>
              <Select
                value={String(value.dayOfMonth)}
                onValueChange={(v) => patch({ dayOfMonth: Number(v) })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent onCloseAutoFocus={(e) => e.preventDefault()}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {value.frequency === "hourly" ? (
            <div className="space-y-1.5">
              <Label>At minute</Label>
              <Select
                value={String(value.minute)}
                onValueChange={(v) => patch({ minute: Number(v) })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent onCloseAutoFocus={(e) => e.preventDefault()}>
                  {[0, 5, 10, 15, 20, 30, 45].map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      :{pad2(m)} past the hour
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <TimeSelects
              hour={value.hour}
              minute={value.minute}
              onHourChange={(h) => patch({ hour: h })}
              onMinuteChange={(m) => patch({ minute: m })}
            />
          )}
        </>
      )}

      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Summary: </span>
        {summary}
      </div>
    </div>
  );
}
