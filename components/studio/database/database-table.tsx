"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

function useHorizontalScroll(ref: React.RefObject<HTMLDivElement | null>) {
  const [hasHorizontalScroll, setHasHorizontalScroll] = React.useState(false);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const checkScroll = () => {
      const hasScroll = element.scrollWidth > element.clientWidth;
      setHasHorizontalScroll(hasScroll);
      if (hasScroll) {
        setCanScrollLeft(element.scrollLeft > 0);
        setCanScrollRight(element.scrollLeft < element.scrollWidth - element.clientWidth);
      } else {
        setCanScrollLeft(false);
        setCanScrollRight(false);
      }
    };

    const handleScroll = () => {
      if (hasHorizontalScroll) {
        setCanScrollLeft(element.scrollLeft > 0);
        setCanScrollRight(element.scrollLeft < element.scrollWidth - element.clientWidth);
      }
    };

    checkScroll();
    element.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", checkScroll);

    return () => {
      element.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [ref, hasHorizontalScroll]);

  return { hasHorizontalScroll, canScrollLeft, canScrollRight };
}

interface ShadowScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  containerClassName?: string;
  outerContainerRef?: React.Ref<HTMLDivElement>;
}

const ShadowScrollArea = React.forwardRef<HTMLDivElement, ShadowScrollAreaProps>(
  ({ className, containerClassName, children, outerContainerRef, ...props }, _ref) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const { hasHorizontalScroll, canScrollLeft, canScrollRight } = useHorizontalScroll(containerRef);

    return (
      <div ref={outerContainerRef} className={cn(containerClassName, "relative flex flex-1 flex-col min-h-0")}>
        <div
          className={cn(
            "absolute inset-0 pointer-events-none z-[2]",
            "before:absolute before:top-0 before:right-0 before:bottom-0 before:w-6 before:bg-gradient-to-l before:from-black/5 dark:before:from-black/20 before:to-transparent before:opacity-0 before:transition-all before:duration-400",
            "after:absolute after:top-0 after:left-0 after:bottom-0 after:w-6 after:bg-gradient-to-r after:from-black/5 dark:after:from-black/20 after:to-transparent after:opacity-0 after:transition-all after:duration-400",
            hasHorizontalScroll && "hover:before:opacity-100 hover:after:opacity-100",
            canScrollRight && "before:opacity-100",
            canScrollLeft && "after:opacity-100",
          )}
        />
        <div
          ref={containerRef}
          className={cn("w-full overflow-auto flex-1", className)}
          {...props}
        >
          {children}
        </div>
      </div>
    );
  },
);
ShadowScrollArea.displayName = "ShadowScrollArea";

interface DatabaseTableProps extends React.HTMLAttributes<HTMLTableElement> {
  containerProps?: Partial<React.ComponentProps<typeof ShadowScrollArea>>;
}

const DatabaseTable = React.forwardRef<HTMLTableElement, DatabaseTableProps>(
  ({ className, containerProps, ...props }, ref) => {
    return (
      <ShadowScrollArea {...containerProps}>
        <table
          ref={ref}
          className={cn("group/table w-full caption-bottom text-sm", className)}
          {...props}
        />
      </ShadowScrollArea>
    );
  },
);
DatabaseTable.displayName = "DatabaseTable";

const DatabaseTableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("[&_tr]:border-b [&>tr]:bg-200", className)}
    {...props}
  />
));
DatabaseTableHeader.displayName = "DatabaseTableHeader";

const DatabaseTableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
DatabaseTableBody.displayName = "DatabaseTableBody";

const DatabaseTableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors group data-[state=selected]:bg-muted hover:bg-surface-200 has-aria-expanded:bg-surface-200",
      className,
    )}
    {...props}
  />
));
DatabaseTableRow.displayName = "DatabaseTableRow";

const DatabaseTableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-4 text-left align-middle font-medium whitespace-nowrap text-foreground",
      className,
    )}
    {...props}
  />
));
DatabaseTableHead.displayName = "DatabaseTableHead";

const DatabaseTableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("p-4 align-middle", className)}
    {...props}
  />
));
DatabaseTableCell.displayName = "DatabaseTableCell";

export {
  DatabaseTable,
  DatabaseTableHeader,
  DatabaseTableBody,
  DatabaseTableRow,
  DatabaseTableHead,
  DatabaseTableCell,
};
