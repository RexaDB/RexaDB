"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Check,
  ChevronsUpDown,
  Pencil,
  Plus,
  Trash2,
} from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";

export type ConnectionTag = { name: string; color: string };

export const CONNECTION_TAG_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#22c55e", // green
  "#14b8a6", // teal
  "#0ea5e9", // sky
  "#6366f1", // indigo
  "#a855f7", // purple
  "#ec4899", // pink
  "#71717a", // gray
];

const FALLBACK_TAG_COLOR = "#71717a";

/** Normalizes a connection's `tags` field, which may arrive as an array or a JSON string. */
export function getConnectionTagNames(conn: unknown): string[] {
  const raw = (conn as { tags?: unknown } | null)?.tags;
  if (Array.isArray(raw)) return raw.filter((tag): tag is string => typeof tag === "string");
  if (typeof raw === "string" && raw) {
    try {
      return getConnectionTagNames({ tags: JSON.parse(raw) });
    } catch {
      return [];
    }
  }
  return [];
}

export function ConnectionTagBadge({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  const tone = color || FALLBACK_TAG_COLOR;
  return (
    <span
      className={cn(
        "inline-flex h-4.5 max-w-[120px] shrink-0 items-center rounded-full px-2 text-[10px] font-medium leading-none select-none",
        className,
      )}
      style={{
        color: tone,
        backgroundColor: `${tone}1a`,
        boxShadow: `inset 0 0 0 1px ${tone}33`,
      }}
      title={name}
    >
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Badges for a connection's tags, resolving colors from the tag library. */
export function ConnectionTagList({
  names,
  library,
  max = 3,
  className,
}: {
  names: string[];
  library: ConnectionTag[];
  max?: number;
  className?: string;
}) {
  if (names.length === 0) return null;
  const colors = new Map(library.map((tag) => [tag.name, tag.color]));
  const shown = names.slice(0, max);
  const hidden = names.length - shown.length;
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      {shown.map((name) => (
        <ConnectionTagBadge key={name} name={name} color={colors.get(name)} />
      ))}
      {hidden > 0 && (
        <span className="text-[10px] text-muted-foreground" title={names.slice(max).join(", ")}>
          +{hidden}
        </span>
      )}
    </span>
  );
}

function ColorSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CONNECTION_TAG_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Color ${color}`}
          onClick={() => onChange(color)}
          className={cn(
            "size-4 rounded-full outline-none ring-offset-2 ring-offset-popover focus-visible:ring-2 focus-visible:ring-ring",
            value === color && "ring-2 ring-foreground/60",
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

function TagEditor({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial: ConnectionTag;
  submitLabel: string;
  onSubmit: (tag: ConnectionTag) => Promise<boolean>;
  onCancel?: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const ok = await onSubmit({ name: trimmed, color });
    setSaving(false);
    if (ok && !onCancel) {
      setName("");
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-2">
      <Input
        value={name}
        autoFocus={!!onCancel}
        maxLength={32}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            void submit();
          } else if (event.key === "Escape" && onCancel) {
            event.stopPropagation();
            onCancel();
          }
        }}
        placeholder="New tag name"
        className="h-8 text-sm"
      />
      <ColorSwatches value={color} onChange={setColor} />
      <div className="flex items-center gap-1.5">
        {onDelete && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        )}
        <div className="ml-auto flex gap-1.5">
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-7 px-2"
            disabled={!name.trim() || saving}
            onClick={() => void submit()}
          >
            {!onCancel && <Plus className="size-3.5" />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Multi-select for a connection's tags with inline management of the tag
 * library (create, rename, recolor, delete).
 */
export function ConnectionTagPicker({
  library,
  value,
  onChange,
  onSaveTag,
  onDeleteTag,
}: {
  library: ConnectionTag[];
  value: string[];
  onChange: (tags: string[]) => void;
  /** Creates a tag, or updates the tag named `previousName`. Resolves true on success. */
  onSaveTag: (tag: ConnectionTag, previousName?: string) => Promise<boolean>;
  onDeleteTag: (name: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const nextColor =
    CONNECTION_TAG_COLORS[library.length % CONNECTION_TAG_COLORS.length];

  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((tag) => tag !== name) : [...value, name]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEditing(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between border-border/60 bg-background px-3 text-sm font-normal"
        >
          {value.length === 0 ? (
            <span className="text-muted-foreground">Select tags</span>
          ) : (
            <ConnectionTagList names={value} library={library} max={2} />
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[max(var(--radix-popover-trigger-width),16rem)] space-y-2 bg-popover p-1.5"
      >
        {library.length === 0 ? (
          <div className="px-2 py-3 text-center text-sm text-muted-foreground">
            No tags yet. Create one below.
          </div>
        ) : (
          <div className="max-h-60 space-y-0.5 overflow-y-auto">
            {library.map((tag) =>
              editing === tag.name ? (
                <TagEditor
                  key={tag.name}
                  initial={tag}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (next) => {
                    const ok = await onSaveTag(next, tag.name);
                    if (ok) {
                      setEditing(null);
                      if (next.name !== tag.name && value.includes(tag.name)) {
                        onChange(value.map((name) => (name === tag.name ? next.name : name)));
                      }
                    }
                    return ok;
                  }}
                  onDelete={async () => {
                    if (await onDeleteTag(tag.name)) {
                      setEditing(null);
                      if (value.includes(tag.name)) onChange(value.filter((name) => name !== tag.name));
                    }
                  }}
                />
              ) : (
                <div
                  key={tag.name}
                  role="option"
                  aria-selected={value.includes(tag.name)}
                  className="group/tag flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    toggle(tag.name);
                  }}
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border",
                      value.includes(tag.name) ? "border-primary bg-primary" : "border-border",
                    )}
                  >
                    {value.includes(tag.name) && <Check className="size-3 text-primary-foreground" />}
                  </span>
                  <ConnectionTagBadge name={tag.name} color={tag.color} />
                  <button
                    type="button"
                    aria-label={`Edit tag ${tag.name}`}
                    className="ml-auto rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover/tag:opacity-100 focus-visible:opacity-100"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setEditing(tag.name);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </div>
              ),
            )}
          </div>
        )}
        <TagEditor
          key={`new-${library.length}`}
          initial={{ name: "", color: nextColor }}
          submitLabel="Create tag"
          onSubmit={async (tag) => {
            const ok = await onSaveTag(tag);
            if (ok && !value.includes(tag.name)) onChange([...value, tag.name]);
            return ok;
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
