"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Box, Shield } from "@/lib/icon-theme/lucide-react";
import { CreateResourceShell } from "./shared/create-resource-shell";

interface CreateSchemaViewProps {
  onCreateSchema: (name: string) => Promise<void>;
  isCreating: boolean;
}

export function CreateSchemaView({
  onCreateSchema,
  isCreating,
}: CreateSchemaViewProps) {
  const [schemaName, setSchemaName] = useState("");

  const handleSubmit = () => {
    if (!schemaName.trim()) return;
    onCreateSchema(schemaName.trim());
  };

  return (
    <CreateResourceShell
      title="Create a new schema"
      description="Schemas help you organize your database objects into logical groups."
      buttonLabel="Create Schema"
      onSubmit={handleSubmit}
      disabled={!schemaName.trim() || isCreating}
      isCreating={isCreating}
    >
      <div className="space-y-4 p-6 rounded-lg border border-border bg-secondary/10">
        <Label
          htmlFor="schemaName"
          className="text-xs font-boldtracking-widest text-muted-foreground flex items-center gap-2"
        >
          <Box className="w-3.5 h-3.5" />
          Schema Name
        </Label>
        <Input
          id="schemaName"
          value={schemaName}
          onChange={(e) => setSchemaName(e.target.value)}
          placeholder="e.g. auth, billing, reporting"
          className="bg-background border-border text-foreground focus-visible:ring-purple-500/50 h-10"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && schemaName.trim() && !isCreating) {
              handleSubmit();
            }
          }}
        />
        <p className="text-xs text-muted-foreground italic">
          Names should be lowercase and contain no spaces. Use underscores for
          separation.
        </p>
      </div>

      <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-3">
        <Label className="text-xs font-boldtracking-widest text-muted-foreground flex items-center gap-2">
          <Shield className="w-3.5 h-3.5" />
          Best Practices
        </Label>
        <ul className="text-xs space-y-2 text-foreground/70 list-disc list-inside">
          <li>Use schemas to separate multi-tenant data</li>
          <li>
            Group related tables (e.g., all authentication tables in an{" "}
            <code className="bg-muted px-1 rounded">auth</code> schema)
          </li>
          <li>Avoid using reserved keywords as schema names</li>
        </ul>
      </div>
    </CreateResourceShell>
  );
}
