"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { X } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_STORAGE_SETTINGS,
  loadStorageSettings,
  saveStorageSettings,
  type StorageSettings,
} from "@/lib/studio/storage-utils";
import { cn } from "@/lib/utils";

function ConfigRow({
  label,
  description,
  children,
  className,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 border-b border-border/60 py-5 last:border-0 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] md:items-start md:gap-8",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0 md:justify-self-end md:w-full">{children}</div>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card/40">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      <div className="px-5">{children}</div>
    </section>
  );
}

export function StorageSettingsView({ studio }: { studio: any }) {
  const connectionId = studio.connection?.id ?? "default";
  const [settings, setSettings] = useState<StorageSettings>(() =>
    loadStorageSettings(connectionId),
  );
  const [mimeDraft, setMimeDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSettings(loadStorageSettings(connectionId));
  }, [connectionId]);

  const isDirty = useMemo(() => {
    const saved = loadStorageSettings(connectionId);
    return JSON.stringify(saved) !== JSON.stringify(settings);
  }, [connectionId, settings]);

  const s3Disabled = settings.storageBackend === "file";

  function update<K extends keyof StorageSettings>(key: K, value: StorageSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function addMimeType() {
    const value = mimeDraft.trim().toLowerCase();
    if (!value) return;
    if (settings.allowedMimeTypes.includes(value)) {
      setMimeDraft("");
      return;
    }
    update("allowedMimeTypes", [...settings.allowedMimeTypes, value]);
    setMimeDraft("");
  }

  function removeMimeType(type: string) {
    update(
      "allowedMimeTypes",
      settings.allowedMimeTypes.filter((t) => t !== type),
    );
  }

  function handleSave() {
    setSaving(true);
    try {
      saveStorageSettings(connectionId, settings);
      toast.success("Storage settings saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setSettings(loadStorageSettings(connectionId));
    setMimeDraft("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-studio-bg">
      <div className="flex items-center justify-between gap-4 border-b border-studio-border px-6 py-4">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">Settings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Configure upload limits, backend, and allowed content types for Storage.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={!isDirty || saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!isDirty || saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
          <SectionCard title="Configuration">
            <ConfigRow
              label="Upload file size limit"
              description="The maximum file size our storage will accept in MB (Max is 50GB, or 51200MB)"
            >
              <div className="relative">
                <Input
                  type="number"
                  min={1}
                  max={51200}
                  value={settings.fileSizeLimitMb}
                  onChange={(e) =>
                    update("fileSizeLimitMb", Math.max(1, Number(e.target.value) || 1))
                  }
                  className="h-9 pr-12"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  MB
                </span>
              </div>
            </ConfigRow>
            <ConfigRow
              label="Storage backend"
              description={
                settings.storageBackend === "file"
                  ? "Currently using local filesystem for object storage"
                  : "Currently using S3 for object storage"
              }
            >
              <Select
                value={settings.storageBackend}
                onValueChange={(v) => update("storageBackend", v as "file" | "s3")}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="file">File system</SelectItem>
                  <SelectItem value="s3">S3</SelectItem>
                </SelectContent>
              </Select>
            </ConfigRow>
          </SectionCard>

          <SectionCard title="S3 Connection">
            <ConfigRow
              label="S3 access key ID"
              description="This key ID grants full access to all S3 resources for authentication"
            >
              <Input
                value={settings.s3ProtocolAccessKeyId}
                onChange={(e) => update("s3ProtocolAccessKeyId", e.target.value)}
                className="h-9 font-mono text-xs"
                placeholder="Access key ID"
              />
            </ConfigRow>
            <ConfigRow
              label="S3 access key secret"
              description="This secret key grants full access to all S3 resources for authentication"
            >
              <Input
                type="password"
                value={settings.s3ProtocolAccessKeySecret}
                onChange={(e) => update("s3ProtocolAccessKeySecret", e.target.value)}
                className="h-9 font-mono text-xs"
                placeholder="Access key secret"
              />
            </ConfigRow>
            <ConfigRow label="Region" description="The default region for requests to S3">
              <Input
                value={settings.s3ProtocolRegion}
                onChange={(e) => update("s3ProtocolRegion", e.target.value)}
                className="h-9"
                placeholder="us-east-1"
              />
            </ConfigRow>
            <ConfigRow
              label="Endpoint"
              description={
                s3Disabled
                  ? "Only relevant when using S3 storage backend"
                  : "Custom S3-compatible endpoint URL"
              }
            >
              <Input
                value={settings.s3ConnectionEndpoint}
                onChange={(e) => update("s3ConnectionEndpoint", e.target.value)}
                className="h-9 font-mono text-xs"
                placeholder="https://s3.amazonaws.com"
                disabled={s3Disabled}
              />
            </ConfigRow>
            <ConfigRow
              label="Access key ID"
              description={
                s3Disabled
                  ? "Only relevant when using S3 storage backend"
                  : "Access key ID for the S3 backend"
              }
            >
              <Input
                value={settings.s3ConnectionAccessKeyId}
                onChange={(e) => update("s3ConnectionAccessKeyId", e.target.value)}
                className="h-9 font-mono text-xs"
                disabled={s3Disabled}
              />
            </ConfigRow>
            <ConfigRow
              label="Access key secret"
              description={
                s3Disabled
                  ? "Only relevant when using S3 storage backend"
                  : "Access key secret for the S3 backend"
              }
            >
              <Input
                type="password"
                value={settings.s3ConnectionAccessKeySecret}
                onChange={(e) => update("s3ConnectionAccessKeySecret", e.target.value)}
                className="h-9 font-mono text-xs"
                disabled={s3Disabled}
              />
            </ConfigRow>
            <ConfigRow
              label="Region"
              description={
                s3Disabled
                  ? "Only relevant when using S3 storage backend"
                  : "Region for the S3 backend"
              }
            >
              <Input
                value={settings.s3ConnectionRegion}
                onChange={(e) => update("s3ConnectionRegion", e.target.value)}
                className="h-9"
                disabled={s3Disabled}
              />
            </ConfigRow>
            <ConfigRow
              label="Force path-style URLs"
              description={
                s3Disabled
                  ? "Only relevant when using S3 storage backend"
                  : "Use path-style addressing instead of virtual-hosted style"
              }
            >
              <div className="flex h-9 items-center justify-end">
                <Switch
                  checked={settings.s3ConnectionForcePathStyle}
                  onCheckedChange={(v) => update("s3ConnectionForcePathStyle", v)}
                  disabled={s3Disabled}
                />
              </div>
            </ConfigRow>
          </SectionCard>

          <SectionCard title="File size restrictions">
            <ConfigRow
              label="Allowed MIME types"
              description="Wildcards such as image/* can also be used as a value. Leave empty to allow any MIME type."
            >
              <div className="space-y-2">
                <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5">
                  {settings.allowedMimeTypes.map((type) => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
                    >
                      {type}
                      <button
                        type="button"
                        aria-label={`Remove ${type}`}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => removeMimeType(type)}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={mimeDraft}
                    onChange={(e) => setMimeDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addMimeType();
                      }
                      if (e.key === "Backspace" && !mimeDraft && settings.allowedMimeTypes.length) {
                        removeMimeType(
                          settings.allowedMimeTypes[settings.allowedMimeTypes.length - 1],
                        );
                      }
                    }}
                    onBlur={addMimeType}
                    placeholder={
                      settings.allowedMimeTypes.length === 0 ? "e.g. image/png" : ""
                    }
                    className="min-w-[120px] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                  />
                </div>
                <Label className="sr-only">Add MIME type</Label>
              </div>
            </ConfigRow>
          </SectionCard>

          {/* Keep defaults reachable without cluttering the form */}
          {settings === DEFAULT_STORAGE_SETTINGS ? null : null}
        </div>
      </div>
    </div>
  );
}
