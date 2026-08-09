"use client";

import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "@/lib/icon-theme/lucide-react";

interface PasswordInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggleShow: () => void;
}

export function PasswordInput({
  id,
  value,
  onChange,
  show,
  onToggleShow,
}: PasswordInputProps) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background border-border/60 h-9 pr-8"
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={onToggleShow}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}
