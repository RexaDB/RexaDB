"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { useUiComponent } from "@/lib/extensions/ui-registry";

const InputDefault = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        data-slot="input"
        ref={ref}
        className={cn(
          "dark:bg-input/30 border-input focus-visible:border-border focus-visible:ring-0 focus-visible:ring-inset aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-8 rounded-lg border bg-transparent px-2.5 py-1 text-sm transition-colors file:h-6 file:text-sm file:font-medium focus-visible:ring-0 aria-invalid:ring-3 file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
InputDefault.displayName = "InputDefault";

/**
 * App-wide Input. Style packs target `[data-slot="input"]`; trusted plugins
 * can `registerUiComponent("input", MyInput)` (compose `InputDefault`).
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>((props, ref) => {
  const Comp = useUiComponent("input", InputDefault);
  return <Comp {...props} ref={ref} />;
});
Input.displayName = "Input";

export { Input, InputDefault };
