"use client";

import { Input } from "@/components/ui/input";

interface AuthSectionSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function AuthSectionSearch({ value, onChange, placeholder }: AuthSectionSearchProps) {
  return (
    <div className="mt-4 max-w-md">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Search..."}
        className="h-9 text-sm"
      />
    </div>
  );
}
