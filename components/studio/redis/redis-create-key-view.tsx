"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { RedisCreateKeyInput } from "@/types/redis";
import { RedisCreateKeyFields, type RedisCreateKeyFieldValues } from "./redis-create-key-fields";
import { DbListPage } from "../database/db-list-layout";

const emptyValues: RedisCreateKeyFieldValues = { key: "", type: "string", rawValue: "", ttlSeconds: "" };

interface RedisCreateKeyViewProps {
  onCreateKey: (input: RedisCreateKeyInput) => Promise<boolean> | boolean;
  onClose: () => void;
}

export function RedisCreateKeyView({ onCreateKey, onClose }: RedisCreateKeyViewProps) {
  const [values, setValues] = useState<RedisCreateKeyFieldValues>(emptyValues);
  const [isSaving, setIsSaving] = useState(false);
  const handleCreate = async () => {
    const ttl = values.ttlSeconds ? Number(values.ttlSeconds) : null;
    setIsSaving(true);
    const ok = await onCreateKey({ key: values.key.trim(), type: values.type, rawValue: values.rawValue, ttlSeconds: ttl });
    setIsSaving(false);
    if (ok) onClose();
  };
  return (
    <DbListPage>
      <div className="p-8 pb-4">
        <h1 className="text-sm font-semibold text-foreground tracking-tight">New Redis Key</h1>
        <p className="text-sm text-muted-foreground mt-1">Create a key with value and optional TTL.</p>
      </div>
      <div className="px-8 pb-8 max-w-2xl w-full">
        <RedisCreateKeyFields values={values} onChange={(next) => setValues((prev) => ({ ...prev, ...next }))} />
        <div className="mt-6 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={isSaving}>{isSaving ? "Creating..." : "Create Key"}</Button>
        </div>
      </div>
    </DbListPage>
  );
}
