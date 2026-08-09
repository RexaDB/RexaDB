"use client";

import { Zap, Shield, Database } from "@/lib/icon-theme/lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AdvisorCategorySummary } from "@/lib/db/advisor";

const iconMap = {
  performance: Zap,
  security: Shield,
  schema: Database,
};

export function AdvisorSummary({
  summaries,
  isRunning,
}: {
  summaries: AdvisorCategorySummary[];
  isRunning: boolean;
}) {
  const totalCritical = summaries.reduce((s, c) => s + c.critical, 0);
  const totalWarnings = summaries.reduce((s, c) => s + c.warnings, 0);
  const totalInfo = summaries.reduce((s, c) => s + c.info, 0);

  return (
    <div className="grid grid-cols-3 gap-3 mb-4">
      <Card className="border-red-500/20">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
            <span className="text-red-500 text-xs font-bold">
              {isRunning ? "..." : totalCritical}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Critical</p>
            <p className="text-xs text-muted-foreground truncate">
              Issues requiring immediate attention
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="border-amber-500/20">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
            <span className="text-amber-500 text-xs font-bold">
              {isRunning ? "..." : totalWarnings}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Warnings</p>
            <p className="text-xs text-muted-foreground truncate">
              Should be reviewed and addressed
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="border-blue-500/20">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
            <span className="text-blue-500 text-xs font-bold">
              {isRunning ? "..." : totalInfo}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Info</p>
            <p className="text-xs text-muted-foreground truncate">
              Suggestions and optimizations
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
