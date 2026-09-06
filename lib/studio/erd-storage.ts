import type { ConnectionDbType } from "@/lib/db/connection-type";

export type ErdColumn = {
  name: string;
  type: string;
  isPrimary: boolean;
  isNullable: boolean;
  references: {
    schema: string;
    table: string;
    column: string;
  } | null;
};

export type ErdTable = {
  schema: string;
  name: string;
  columns: ErdColumn[];
};

export type ErdProject = {
  id: string;
  name: string;
  schemaName: string;
  dbType: ConnectionDbType;
  tables: Record<string, ErdTable>;
  positions?: Record<string, { x: number; y: number }>;
  createdAt: string;
  updatedAt: string;
};

const storageKey = (connectionId: number | string) =>
  `rexa-db-erd-projects-${connectionId}`;

function readAll(connectionId: number | string): ErdProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(connectionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ErdProject[]) : [];
  } catch {
    return [];
  }
}

function writeAll(connectionId: number | string, projects: ErdProject[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(connectionId), JSON.stringify(projects));
}

function nowIso() {
  return new Date().toISOString();
}

function uid() {
  return `erd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function tableKey(schema: string, name: string) {
  return `${schema}.${name}`;
}

export function listErdProjects(connectionId: number | string): ErdProject[] {
  return readAll(connectionId).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function getErdProject(
  connectionId: number | string,
  id: string,
): ErdProject | null {
  return readAll(connectionId).find((p) => p.id === id) ?? null;
}

export function saveErdProject(
  connectionId: number | string,
  project: ErdProject,
): ErdProject {
  const next = { ...project, updatedAt: nowIso() };
  const all = readAll(connectionId);
  const idx = all.findIndex((p) => p.id === next.id);
  if (idx >= 0) all[idx] = next;
  else all.unshift(next);
  writeAll(connectionId, all);
  return next;
}

export function deleteErdProject(
  connectionId: number | string,
  id: string,
): void {
  writeAll(
    connectionId,
    readAll(connectionId).filter((p) => p.id !== id),
  );
}

export function renameErdProject(
  connectionId: number | string,
  id: string,
  name: string,
): ErdProject | null {
  const existing = getErdProject(connectionId, id);
  if (!existing) return null;
  return saveErdProject(connectionId, { ...existing, name });
}

export function createErdProject(opts: {
  connectionId: number | string;
  name?: string;
  schemaName?: string;
  dbType: ConnectionDbType;
  tables?: Record<string, ErdTable>;
  positions?: Record<string, { x: number; y: number }>;
}): ErdProject {
  const stamp = nowIso();
  const project: ErdProject = {
    id: uid(),
    name: opts.name?.trim() || "New ERD",
    schemaName: opts.schemaName?.trim() || "public",
    dbType: opts.dbType,
    tables: opts.tables ?? {},
    positions: opts.positions,
    createdAt: stamp,
    updatedAt: stamp,
  };
  return saveErdProject(opts.connectionId, project);
}

export function duplicateErdProject(
  connectionId: number | string,
  id: string,
): ErdProject | null {
  const existing = getErdProject(connectionId, id);
  if (!existing) return null;
  return createErdProject({
    connectionId,
    name: `${existing.name} (copy)`,
    schemaName: existing.schemaName,
    dbType: existing.dbType,
    tables: structuredClone(existing.tables),
    positions: existing.positions
      ? structuredClone(existing.positions)
      : undefined,
  });
}

/** Clone live schemaData (filtered to one schema) into a new local ERD project. */
export function importErdFromSchemaData(opts: {
  connectionId: number | string;
  name?: string;
  schemaName: string;
  dbType: ConnectionDbType;
  schemaData: Record<string, ErdTable | undefined>;
}): ErdProject {
  const tables: Record<string, ErdTable> = {};
  for (const table of Object.values(opts.schemaData)) {
    if (!table) continue;
    if (table.schema.toLowerCase() !== opts.schemaName.toLowerCase()) continue;
    tables[tableKey(table.schema, table.name)] = {
      schema: table.schema,
      name: table.name,
      columns: (table.columns ?? []).map((col) => ({
        name: col.name,
        type: col.type,
        isPrimary: Boolean(col.isPrimary),
        isNullable: Boolean(col.isNullable),
        references: col.references
          ? {
              schema: col.references.schema,
              table: col.references.table,
              column: col.references.column,
            }
          : null,
      })),
    };
  }
  return createErdProject({
    connectionId: opts.connectionId,
    name: opts.name?.trim() || `${opts.schemaName} ERD`,
    schemaName: opts.schemaName,
    dbType: opts.dbType,
    tables,
  });
}

export const ERD_FEATURE_CHECKLIST = [
  { id: "create", label: "Create a new ERD project" },
  { id: "add-tables", label: "Add tables visually" },
  { id: "define-columns", label: "Define columns and datatypes" },
  { id: "add-relationships", label: "Add relationships between tables" },
  { id: "edit-relationships", label: "Edit relationships" },
  { id: "rearrange", label: "Rearrange tables in the canvas" },
  { id: "overview", label: "View ERD overview" },
  { id: "export-sql", label: "Export ERD to SQL" },
  { id: "save", label: "Save ERD locally" },
  { id: "import-db", label: "Import ERD from existing DB" },
] as const;

export type ErdFeatureId = (typeof ERD_FEATURE_CHECKLIST)[number]["id"];

export function computeErdProgress(projects: ErdProject[]): {
  completed: Set<ErdFeatureId>;
  percent: number;
} {
  const completed = new Set<ErdFeatureId>();
  if (projects.length > 0) completed.add("create");

  const hasTables = projects.some((p) => Object.keys(p.tables).length > 0);
  if (hasTables) completed.add("add-tables");

  const hasColumns = projects.some((p) =>
    Object.values(p.tables).some((t) => (t.columns?.length ?? 0) > 0),
  );
  if (hasColumns) completed.add("define-columns");

  const hasRelationships = projects.some((p) =>
    Object.values(p.tables).some((t) =>
      (t.columns ?? []).some((c) => Boolean(c.references)),
    ),
  );
  if (hasRelationships) completed.add("add-relationships");

  // Edit relationships / rearrange / overview / export / save / import are
  // session milestones tracked via local flags (see erds-panel).
  if (typeof window !== "undefined") {
    try {
      const flags = JSON.parse(
        localStorage.getItem("rexa-db-erd-progress-flags") || "{}",
      ) as Partial<Record<ErdFeatureId, boolean>>;
      for (const id of ERD_FEATURE_CHECKLIST.map((f) => f.id)) {
        if (flags[id]) completed.add(id);
      }
    } catch {
      /* ignore */
    }
  }

  const percent = Math.round(
    (completed.size / ERD_FEATURE_CHECKLIST.length) * 100,
  );
  return { completed, percent };
}

export function markErdFeature(id: ErdFeatureId) {
  if (typeof window === "undefined") return;
  try {
    const flags = JSON.parse(
      localStorage.getItem("rexa-db-erd-progress-flags") || "{}",
    ) as Partial<Record<ErdFeatureId, boolean>>;
    flags[id] = true;
    localStorage.setItem("rexa-db-erd-progress-flags", JSON.stringify(flags));
    window.dispatchEvent(new CustomEvent("studio:erd-progress"));
  } catch {
    /* ignore */
  }
}
