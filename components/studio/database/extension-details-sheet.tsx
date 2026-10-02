"use client";

import {
  StudioSheetContent as SheetContent,
  StudioSheetFooter as SheetFooter,
  StudioSheetHeader as SheetHeader,
  StudioSheetTitle as SheetTitle,
  StudioSheetDescription as SheetDescription,
} from "@/components/common/studio-sheet";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Box, Check, ExternalLink, RefreshCw } from "@/lib/icon-theme/lucide-react";
import type { DatabaseExtension } from "./extensions-types";

interface ExtensionDetailsSheetProps {
  extension: DatabaseExtension | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleExtension: (name: string, install: boolean) => Promise<void>;
  isLoading?: boolean;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-1 sm:gap-4 border-b border-studio-border/60 py-3">
      <span className="text-xs sm:text-xs tracking-[0.14em] text-muted-foreground/60 shrink-0">
        {label}
      </span>
      <span className="w-full sm:w-auto sm:max-w-[65%] text-left sm:text-right text-xs sm:text-sm text-foreground break-words">
        {value}
      </span>
    </div>
  );
}

export function ExtensionDetailsSheet({
  extension,
  open,
  onOpenChange,
  onToggleExtension,
  isLoading = false,
}: ExtensionDetailsSheetProps) {
  if (!extension) return null;

  const isInstalled = !!extension.installed_version;
  const docsHref = `https://www.postgresql.org/docs/current/${extension.name}.html`;
  const searchHref = `https://www.google.com/search?q=postgresql+extension+${extension.name}`;
  const capabilities = [
    extension.trusted ? "Trusted" : null,
    extension.relocatable ? "Relocatable" : null,
    extension.superuser ? "Requires superuser" : null,
  ].filter(Boolean) as string[];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        contained
        className="w-[min(520px,95vw)] bg-studio-bg border-studio-border text-foreground p-0"
      >
        <SheetHeader>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md",
                isInstalled
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Box className="size-4" />
            </div>
            <SheetTitle className="truncate">{extension.name}</SheetTitle>
            <Badge
              variant={isInstalled ? "secondary" : "outline"}
              className={cn(
                "h-5 shrink-0 px-1.5 text-xs",
                isInstalled && "border-none bg-emerald-500/10 text-emerald-500",
              )}
            >
              {isInstalled ? "Installed" : "Available"}
            </Badge>
            <Badge
              variant="outline"
              className="h-5 shrink-0 px-1.5 font-mono text-xs"
            >
              v{extension.installed_version || extension.default_version}
            </Badge>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3 sm:py-4">
          <p className="mb-4 text-xs text-muted-foreground">
            {extension.comment ||
              "No extension description is available for this package."}
          </p>
          <div className="mb-4 sm:mb-5 flex flex-wrap gap-1.5 sm:gap-2">
            <a
              href={searchHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 sm:flex-none"
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-7 sm:h-8 text-xs sm:text-xs w-full"
              >
                Search
                <ExternalLink className="ml-1 h-3 w-3 sm:ml-1.5 sm:h-3.5 sm:w-3.5" />
              </Button>
            </a>
          </div>

          <div className="rounded-lg sm:rounded-lg border border-studio-border/70 bg-background/30 px-3 sm:px-4">
            <DetailRow
              label="Default version"
              value={extension.default_version || "Unknown"}
            />
            <DetailRow
              label="Installed version"
              value={extension.installed_version || "Not installed"}
            />
            <DetailRow
              label="Installed schema"
              value={extension.installed_schema || "Not installed"}
            />
            <DetailRow
              label="Default schema"
              value={extension.default_schema || "Database default"}
            />
            <DetailRow
              label="Dependencies"
              value={extension.requires || "None"}
            />
            <DetailRow
              label="Available versions"
              value={extension.available_versions || extension.default_version}
            />
          </div>

          {capabilities.length > 0 && (
            <div className="mt-4 sm:mt-5">
              <div className="mb-1.5 sm:mb-2 text-xs sm:text-xs tracking-[0.14em] text-muted-foreground/60">
                Capabilities
              </div>
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {capabilities.map((capability) => (
                  <Badge
                    key={capability}
                    variant="outline"
                    className="h-5 sm:h-6 px-1.5 sm:px-2 text-xs sm:text-xs"
                  >
                    {capability}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="border-t border-studio-border/80 bg-background/20 px-4 sm:px-5 py-2.5 sm:py-3">
          <Button
            variant={isInstalled ? "outline" : "default"}
            className={cn(
              "ml-auto h-7 sm:h-8 px-2.5 sm:px-3 text-xs sm:text-xs w-full sm:w-auto",
              isInstalled
                ? "border-red-500/20 text-red-500 hover:bg-red-500/10 hover:border-red-500/30"
                : "bg-primary hover:bg-primary/90 text-primary-foreground",
            )}
            disabled={isLoading}
            onClick={() => void onToggleExtension(extension.name, !isInstalled)}
          >
            {isLoading ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : isInstalled ? (
              "Uninstall extension"
            ) : (
              "Install extension"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
