"use client";

import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RotateCcw, Upload } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";

/**
 * A connection's custom icon is stored as `emoji:<char>` or
 * `image:<data url>`. Anything else (including null) means "use the provider logo".
 */
export type ConnectionIconValue = string | null;

const EMOJI_CHOICES = [
  "🚀", "🔥", "⚡", "🌱", "🧪", "🛠️", "🐞", "🔒",
  "💾", "📦", "📊", "📈", "🧠", "🤖", "🌍", "☁️",
  "🏠", "🏢", "🛒", "💳", "🎮", "🎯", "⭐", "💎",
  "🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "⬛", "⬜",
];

const IMAGE_ICON_SIZE = 64;

export function parseConnectionIcon(icon: unknown) {
  if (typeof icon !== "string") return null;
  if (icon.startsWith("emoji:")) return { kind: "emoji" as const, value: icon.slice(6) };
  if (icon.startsWith("image:")) return { kind: "image" as const, value: icon.slice(6) };
  return null;
}

/** Renders a connection's custom icon, or `fallback` (the provider logo) when it has none. */
export function ConnectionIcon({
  icon,
  fallback,
  className,
}: {
  icon: unknown;
  fallback: ReactNode;
  className?: string;
}) {
  const parsed = parseConnectionIcon(icon);
  if (!parsed) return <>{fallback}</>;
  if (parsed.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={parsed.value}
        alt=""
        className={cn("shrink-0 rounded-md object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center leading-none select-none",
        className,
      )}
    >
      <span className="text-[0.85em] leading-none">{parsed.value}</span>
    </span>
  );
}

/** Downscales an image file to a square PNG data URL so it stays small in SQLite. */
function imageFileToIconDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = IMAGE_ICON_SIZE;
      canvas.height = IMAGE_ICON_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas is unavailable."));
      // Cover-crop to a centered square.
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, side, side, 0, 0, IMAGE_ICON_SIZE, IMAGE_ICON_SIZE);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

/** Clickable icon well that opens a popover to pick an emoji, upload an image, or reset to the provider logo. */
export function ConnectionIconPicker({
  value,
  onChange,
  fallback,
}: {
  value: ConnectionIconValue;
  onChange: (value: ConnectionIconValue) => void;
  fallback: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [customEmoji, setCustomEmoji] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const current = parseConnectionIcon(value);

  const pick = (next: ConnectionIconValue) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Change connection icon"
          title="Change icon"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-2xl outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ConnectionIcon icon={value} fallback={fallback} className="size-6" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 bg-popover p-3">
        <div className="grid grid-cols-8 gap-1">
          {EMOJI_CHOICES.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => pick(`emoji:${emoji}`)}
              className={cn(
                "flex size-7 items-center justify-center rounded-md text-base hover:bg-accent",
                current?.kind === "emoji" && current.value === emoji && "bg-accent ring-1 ring-primary/50",
              )}
            >
              {emoji}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const emoji = customEmoji.trim();
            if (!emoji) return;
            setCustomEmoji("");
            pick(`emoji:${[...emoji].slice(0, 2).join("")}`);
          }}
        >
          <Input
            value={customEmoji}
            onChange={(event) => setCustomEmoji(event.target.value)}
            placeholder="Any emoji or character"
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" className="h-8">
            Use
          </Button>
        </form>
        <div className="flex gap-2 border-t border-border/40 pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 flex-1"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            Upload image
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            disabled={!current}
            onClick={() => pick(null)}
          >
            <RotateCcw className="size-3.5" />
            Default
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
              pick(`image:${await imageFileToIconDataUrl(file)}`);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not use that image.");
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
