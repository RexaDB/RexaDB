"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { useId } from "react";
import { useUiComponent } from "@/lib/extensions/ui-registry";

import { ButtonContent } from "@/components/ui/button-content";

const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/50 relative inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] border border-transparent text-[13px] font-normal whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Primary — solid. Same geometry as toolbar pill, only color differs.
        default: "border-transparent bg-primary text-primary-foreground font-medium hover:bg-primary/90",
        // Neutral / toolbar — matches the reference pill:
        // dark: ~#1c1c1e fill, 1px rgba(255,255,255,0.12) border, #d4d4d4 text.
        outline:
          "border-border bg-background text-foreground hover:bg-muted/60 hover:text-foreground dark:border-white/12 dark:bg-white/[0.03] dark:text-neutral-200 dark:hover:bg-white/[0.07] dark:hover:text-white aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "border-transparent bg-muted text-foreground font-medium hover:bg-muted/60 dark:bg-white/[0.07] dark:text-neutral-100 dark:hover:bg-white/[0.1]",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:hover:bg-white/[0.06] aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "border-transparent bg-destructive font-medium text-white hover:bg-destructive/90 dark:bg-[#b54444] dark:hover:bg-[#a53c3c]",
        link: "border-transparent bg-transparent rounded-none gap-1 px-0 h-auto text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3",
        xs: "h-6 gap-1.5 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 px-4 text-sm",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Swaps the label for bouncing dots while an action runs. */
    loading?: boolean;
    /**
     * Fills the button from the left, from 0 to 100, e.g. while a file
     * uploads. Set it back to `undefined` when the work is done: the bar fills
     * up and fades out. For work you can't measure, use `loading`.
     */
    progress?: number;
  };

function ButtonDefault({
  className,
  variant = "default",
  size = "default",
  loading = false,
  progress,
  disabled,
  focusableWhenDisabled,
  "aria-describedby": ariaDescribedBy,
  children,
  ...props
}: ButtonProps) {
  const hasProgress = progress !== undefined;
  const busy = loading || hasProgress;
  const progressTextId = useId();

  return (
    <ButtonPrimitive
      aria-busy={busy || undefined}
      // Announces the upload percentage without changing the button's name.
      aria-describedby={
        hasProgress
          ? [ariaDescribedBy, progressTextId].filter(Boolean).join(" ")
          : ariaDescribedBy
      }
      className={cn(
        buttonVariants({ variant, size, className }),
        "has-data-[clip]:overflow-hidden",
        busy && "cursor-progress"
      )}
      data-loading={loading ? "" : undefined}
      data-slot="button"
      disabled={disabled || busy}
      focusableWhenDisabled={focusableWhenDisabled ?? busy}
      {...props}
    >
      <ButtonContent
        loading={loading}
        progress={progress}
        progressTextId={progressTextId}
      >
        {children}
      </ButtonContent>
    </ButtonPrimitive>
  );
}

/**
 * App-wide Button. Extensions can restyle every instance via a style pack
 * targeting `[data-slot="button"]`, or replace the React component by
 * registering `registerUiComponent("button", MyButton)` (use `ButtonDefault`
 * inside overrides to avoid recursion).
 */
function Button(props: ButtonProps) {
  const Comp = useUiComponent("button", ButtonDefault);
  return <Comp {...props} />;
}

export { Button, ButtonDefault, buttonVariants };
export type { ButtonProps };
