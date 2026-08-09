import type { LucideIcon } from "lucide-react";
import { SquarePlus } from "@/lib/icon-theme/lucide-react";
import { createElement, isValidElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStatePresentationalProps {
  icon?: LucideIcon | ReactNode;
  title: string;
  description?: string | ReactNode;
  children?: ReactNode;
  className?: string;
  iconSize?: number;
  iconClassName?: string;
  contentClassName?: string;
}

export const EmptyStatePresentational = ({
  icon: Icon,
  title,
  description,
  children,
  className,
  iconSize = 24,
  iconClassName,
  contentClassName,
}: EmptyStatePresentationalProps) => {
  const iconToRender = Icon || SquarePlus;

  const textContent = (
    <div className={cn("flex flex-col items-center text-center text-balance", contentClassName)}>
      <h3>{title}</h3>
      {description && (
        <p className="text-muted-foreground text-sm max-w-[640px]">{description}</p>
      )}
    </div>
  );

  return (
    <aside
      className={cn(
        "border border-dashed w-full bg-surface-100 rounded-lg px-4 py-10 flex flex-col items-center gap-y-3",
        className,
      )}
    >
      <div className="flex flex-col gap-y-3 items-center">
        {isValidElement(iconToRender)
          ? iconToRender
          : typeof iconToRender === "function" ||
              (typeof iconToRender === "object" &&
                iconToRender !== null &&
                "$$typeof" in iconToRender)
            ? createElement(iconToRender as LucideIcon, {
                size: iconSize,
                strokeWidth: 1.5,
                className: cn("text-muted-foreground", iconClassName),
              })
            : iconToRender}
        {textContent}
      </div>
      {children}
    </aside>
  );
};
