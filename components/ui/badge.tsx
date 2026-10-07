import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "h-6 gap-1.5 rounded-full border border-transparent px-3 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&>svg]:size-3! inline-flex items-center justify-center w-fit whitespace-nowrap shrink-0 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive overflow-hidden group/badge",
  {
    variants: {
      variant: {
        default:
          "border-primary/25 bg-primary/15 text-primary dark:border-primary/30 dark:bg-primary/20 [a]:hover:bg-primary/25",
        secondary:
          "border-border bg-muted/60 text-muted-foreground dark:border-white/10 dark:bg-white/[0.06] dark:text-neutral-300 [a]:hover:bg-muted",
        destructive:
          "border-destructive/25 bg-destructive/15 text-destructive dark:border-destructive/30 dark:bg-destructive/20 [a]:hover:bg-destructive/25",
        outline:
          "border-border bg-muted/40 text-muted-foreground dark:border-white/12 dark:bg-white/[0.04] dark:text-neutral-300 [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        success:
          "border-emerald-500/25 bg-emerald-500/15 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/15 dark:text-emerald-300",
        warning:
          "border-amber-500/25 bg-amber-500/15 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/15 dark:text-amber-200",
        info: "border-violet-500/25 bg-violet-500/15 text-violet-700 dark:border-violet-400/20 dark:bg-violet-400/15 dark:text-violet-300",
        ghost: "border-transparent hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge }
