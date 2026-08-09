"use client";

import { DataTableToolbar } from "./data-table-toolbar";
import { DataGridAg as DataGrid } from "./data-grid-ag";
import { PendingChangesBanner } from "./pending-changes-banner";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

type TableEditorViewProps = {
  toolbarProps: ComponentProps<typeof DataTableToolbar>;
  gridProps: ComponentProps<typeof DataGrid>;
  showPendingChangesBanner?: boolean;
  onOpenReviewPanel?: () => void;
};

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse bg-muted rounded", className)} />
  );
}

export function TableEditorView({ toolbarProps, gridProps, showPendingChangesBanner = true, onOpenReviewPanel }: TableEditorViewProps) {
  const isLoading = toolbarProps.loading || toolbarProps.fetchingStructure;
  const useSkeleton = gridProps.skeletonLoaders && isLoading;

  const pendingChanges = (gridProps as any).pendingChanges;
  const pendingActions = (gridProps as any).pendingActions;
  const pendingChangesCount = pendingChanges ? Object.keys(pendingChanges).length : 0;
  const pendingActionsCount = pendingActions ? pendingActions.length : 0;
  const hasPendingItems = pendingChangesCount > 0 || pendingActionsCount > 0;
  const showBanner = showPendingChangesBanner && hasPendingItems;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-studio-bg">
      <DataTableToolbar {...toolbarProps} />
      {showBanner && (
        <PendingChangesBanner
          pendingChangesCount={pendingChangesCount}
          pendingActionsCount={pendingActionsCount}
          onReview={() => onOpenReviewPanel?.()}
        />
      )}
      <div className="w-full bg-transparent overflow-hidden shrink-0 relative">
        {isLoading && !gridProps.skeletonLoaders ? (
          <div className="h-[1px] w-full relative">
            <div className="absolute inset-0 overflow-hidden">
              <div
                className="h-full w-full bg-gradient-to-r from-transparent via-blue-500/40 via-blue-400 via-blue-500/40 to-transparent animate-progress-beam"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        ) : (
          <div className="h-0" />
        )}
      </div>
      
      {useSkeleton ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="h-10 border-b border-studio-border bg-table-header-bg flex items-center px-4 gap-4">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-4 w-20 rounded" />
          </div>
          <div className="flex-1 p-4 space-y-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 flex-1 rounded" />
                <Skeleton className="h-4 w-32 rounded" />
                <Skeleton className="h-4 w-24 rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <DataGrid {...gridProps} />
      )}
    </div>
  );
}
