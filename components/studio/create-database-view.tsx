"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Database, AlertCircle } from "@/lib/icon-theme/lucide-react";
import { CreateResourceShell } from "./shared/create-resource-shell";

interface CreateDatabaseViewProps {
  onCreateDatabase: (name: string) => Promise<void>;
  isCreating: boolean;
}

export function CreateDatabaseView({
  onCreateDatabase,
  isCreating,
}: CreateDatabaseViewProps) {
  const [dbName, setDbName] = useState("");

  const handleSubmit = () => {
    if (!dbName.trim()) return;
    onCreateDatabase(dbName.trim());
  };

  return (
    <CreateResourceShell
      title="Create a new database"
      description="Create a new database in your cluster."
      buttonLabel="Create Database"
      onSubmit={handleSubmit}
      disabled={!dbName.trim() || isCreating}
      isCreating={isCreating}
    >
      <div className="space-y-4 p-6 rounded-lg border border-border bg-secondary/10">
        <Label
          htmlFor="dbName"
          className="text-xs font-boldtracking-widest text-muted-foreground flex items-center gap-2"
        >
          <Database className="w-3.5 h-3.5" />
          Database Name
        </Label>
        <Input
          id="dbName"
          value={dbName}
          onChange={(e) => setDbName(e.target.value)}
          placeholder="e.g. production_backup, analytics_db"
          className="bg-background border-border text-foreground focus-visible:ring-emerald-500/50 h-10"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && dbName.trim() && !isCreating) {
              handleSubmit();
            }
          }}
        />
      </div>

      <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-3">
        <Label className="text-xs font-boldtracking-widest text-amber-600 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" />
          Important Note
        </Label>
        <p className="text-xs text-amber-700/80 leading-relaxed">
          Creating a database might take a few moments depending on your cluster
          configuration. The new database will be created using the default
          template.
        </p>
      </div>
    </CreateResourceShell>
  );
}
