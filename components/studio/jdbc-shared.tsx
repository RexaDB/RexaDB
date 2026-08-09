"use client";

import { useState, useMemo } from "react";
import { DEFAULT_TEMPLATES, type JdbcDriverTemplate } from "@/lib/db/jdbc-templates";

export const JDBC_CATEGORIES = [
  { id: "relational", label: "Relational" },
  { id: "nosql", label: "NoSQL / Document" },
  { id: "analytics", label: "Analytics / Big Data" },
  { id: "cloud", label: "Cloud / SaaS" },
  { id: "timeseries", label: "Time Series / IoT" },
  { id: "embedded", label: "Embedded" },
  { id: "legacy", label: "Legacy" },
];

function logoPath(name: string) {
  const safe = name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  return `/providers/jdbc/${safe}.svg`;
}

function fallbackIcon(name: string, size: number) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const clean = name.replace(/\s*\(JDBC\)|\s*\(JDBCC\)/g, "").trim();
  const parts = clean.split(/\s+/);
  const initials = parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : clean.slice(0, 2).toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-md text-white font-bold text-xs shrink-0"
      style={{ width: size, height: size, backgroundColor: `hsl(${Math.abs(hash) % 360}, 55%, 45%)` }}
    >
      {initials}
    </div>
  );
}

export function useJdbcFilter(search: string) {
  const filtered = useMemo(() => {
    if (!search.trim()) return DEFAULT_TEMPLATES;
    const q = search.toLowerCase();
    return DEFAULT_TEMPLATES.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.driverClass.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q),
    );
  }, [search]);

  const grouped = useMemo(() => {
    const map = new Map<string, JdbcDriverTemplate[]>();
    for (const cat of JDBC_CATEGORIES) map.set(cat.id, []);
    for (const t of filtered) {
      const list = map.get(t.category);
      if (list) list.push(t);
    }
    return JDBC_CATEGORIES.filter((c) => (map.get(c.id)?.length ?? 0) > 0).map(
      (c) => ({
        ...c,
        items: map.get(c.id)!,
      }),
    );
  }, [filtered]);

  return { filtered, grouped };
}

export function JdbcLogo({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallbackIcon(name, size);
  return (
    <img
      src={logoPath(name)}
      alt={name}
      width={size}
      height={size}
      className={className ?? "shrink-0 rounded-md"}
      onError={() => setFailed(true)}
    />
  );
}
