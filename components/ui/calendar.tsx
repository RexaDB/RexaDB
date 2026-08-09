"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "@/lib/icon-theme/lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "flex w-full flex-col gap-4",
        caption: "relative flex h-8 items-center justify-center px-8",
        month_caption: "relative flex h-8 items-center justify-center px-8",
        caption_label:
          "pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-medium text-center",
        nav: "absolute inset-x-0 top-0 z-10 flex h-8 items-center justify-between px-1",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),
        month_grid: "w-full border-collapse",
        weekdays: "mb-1 grid grid-cols-7",
        weekday: "text-muted-foreground text-center text-xs font-normal",
        weeks: "grid gap-1",
        week: "grid grid-cols-7",
        cell: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
          props.mode === "range"
            ? "[&:has(>.rdp-day_range_end)]:rounded-r-md [&:has(>.rdp-day_range_start)]:rounded-l-md"
            : "",
        ),
        day: cn("relative p-0 text-center text-sm"),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-8 w-8 rounded-lg p-0 font-normal aria-selected:opacity-100",
        ),
        selected:
          "rounded-lg bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        today: "rounded-lg bg-accent text-accent-foreground",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        range_middle:
          "rounded-lg aria-selected:bg-accent aria-selected:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...props }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" {...props} />
          ) : (
            <ChevronRight className="h-4 w-4" {...props} />
          ),
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
