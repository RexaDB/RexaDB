"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  SchemaDiagram,
  buildSchemaSql,
  type SchemaDiagramRelationship,
  type SchemaDiagramTable,
} from "@/components/studio/database/schema-diagram";
import { ErdEditTableSheet } from "@/components/studio/erd/erd-edit-table-sheet";
import { ErdEditRelationshipDialog } from "@/components/studio/erd/erd-edit-relationship-dialog";
import {
  getErdProject,
  markErdFeature,
  saveErdProject,
  tableKey,
  type ErdProject,
  type ErdTable,
} from "@/lib/studio/erd-storage";
import type { ConnectionDbType } from "@/lib/db/connection-type";

function downloadText(content: string, fileName: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Delay revoke so Chromium/Tauri can start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ErdDesignerView({
  erdId,
  connectionId,
  dbType,
}: {
  erdId?: string;
  connectionId: number;
  dbType: ConnectionDbType;
}) {
  const [project, setProject] = useState<ErdProject | null>(null);
  const [tableSheetOpen, setTableSheetOpen] = useState(false);
  const [editingTableName, setEditingTableName] = useState<string | null>(null);
  const [relationship, setRelationship] =
    useState<SchemaDiagramRelationship | null>(null);
  const projectRef = useRef<ErdProject | null>(null);
  projectRef.current = project;

  useEffect(() => {
    if (!erdId) {
      setProject(null);
      return;
    }
    const loaded = getErdProject(connectionId, erdId);
    setProject(loaded);
    if (loaded) markErdFeature("overview");
  }, [connectionId, erdId]);

  const schemaData = useMemo(() => {
    if (!project) return {} as Record<string, SchemaDiagramTable>;
    return project.tables as Record<string, SchemaDiagramTable>;
  }, [project]);

  const tableList = useMemo(
    () => (project ? Object.values(project.tables) : []),
    [project],
  );

  const existingNames = useMemo(
    () => tableList.map((t) => t.name),
    [tableList],
  );

  const editingTable = useMemo(() => {
    if (!project || !editingTableName) return null;
    return (
      Object.values(project.tables).find((t) => t.name === editingTableName) ??
      null
    );
  }, [editingTableName, project]);

  /** Persist immediately so remounts / reloads cannot wipe in-progress edits. */
  const commitProject = useCallback(
    (next: ErdProject, opts?: { toastSave?: boolean }) => {
      const saved = saveErdProject(connectionId, next);
      projectRef.current = saved;
      setProject(saved);
      markErdFeature("save");
      window.dispatchEvent(
        new CustomEvent("studio:erd-saved", {
          detail: { erdId: saved.id, name: saved.name },
        }),
      );
      if (opts?.toastSave) toast.success("ERD saved locally");
      return saved;
    },
    [connectionId],
  );

  const handleSchemaDataChange = useCallback(
    (next: Record<string, SchemaDiagramTable>) => {
      const current = projectRef.current;
      if (!current) return;
      const tables: Record<string, ErdTable> = {};
      for (const table of Object.values(next)) {
        if (!table) continue;
        tables[tableKey(table.schema || current.schemaName, table.name)] = {
          schema: table.schema || current.schemaName,
          name: table.name,
          columns: table.columns.map((c) => ({
            name: c.name,
            type: c.type,
            isPrimary: Boolean(c.isPrimary),
            isNullable: Boolean(c.isNullable),
            references: c.references
              ? {
                  schema: c.references.schema,
                  table: c.references.table,
                  column: c.references.column,
                }
              : null,
          })),
        };
      }
      const hadRel = Object.values(current.tables).some((t) =>
        t.columns.some((c) => c.references),
      );
      const hasRel = Object.values(tables).some((t) =>
        t.columns.some((c) => c.references),
      );
      if (hasRel) markErdFeature("add-relationships");
      if (hadRel && hasRel) markErdFeature("edit-relationships");
      commitProject({ ...current, tables });
    },
    [commitProject],
  );

  const handlePositionsChange = useCallback(
    (positions: Record<string, { x: number; y: number }>) => {
      const current = projectRef.current;
      if (!current) return;
      markErdFeature("rearrange");
      commitProject({ ...current, positions });
    },
    [commitProject],
  );

  const handleSubmitTable = useCallback(
    (table: ErdTable) => {
      const current = projectRef.current;
      if (!current) return;
      const tables = { ...current.tables };
      let positions = current.positions;

      if (editingTableName && editingTableName !== table.name) {
        const oldKey = Object.keys(tables).find(
          (k) => tables[k]?.name === editingTableName,
        );
        if (oldKey) delete tables[oldKey];
        for (const key of Object.keys(tables)) {
          const t = tables[key];
          if (!t) continue;
          tables[key] = {
            ...t,
            columns: t.columns.map((c) =>
              c.references?.table === editingTableName
                ? {
                    ...c,
                    references: { ...c.references, table: table.name },
                  }
                : c,
            ),
          };
        }
        if (positions?.[editingTableName]) {
          positions = { ...positions };
          positions[table.name] = positions[editingTableName];
          delete positions[editingTableName];
        }
      }

      tables[tableKey(current.schemaName, table.name)] = {
        ...table,
        schema: current.schemaName,
      };
      commitProject({ ...current, tables, positions });
      markErdFeature("add-tables");
      if (table.columns.length > 0) markErdFeature("define-columns");
      if (table.columns.some((c) => c.references)) {
        markErdFeature("add-relationships");
      }
      toast.success(editingTableName ? "Table updated" : "Table added");
    },
    [commitProject, editingTableName],
  );

  const handleDeleteTable = useCallback(
    (tableName: string) => {
      const current = projectRef.current;
      if (!current) return;
      const tables: Record<string, ErdTable> = {};
      for (const [key, table] of Object.entries(current.tables)) {
        if (table.name === tableName) continue;
        tables[key] = {
          ...table,
          columns: table.columns.map((c) =>
            c.references?.table === tableName
              ? { ...c, references: null }
              : c,
          ),
        };
      }
      const positions = { ...(current.positions ?? {}) };
      delete positions[tableName];
      commitProject({ ...current, tables, positions });
      toast.success("Table deleted");
    },
    [commitProject],
  );

  const handleSaveRelationship = useCallback(
    (rel: SchemaDiagramRelationship) => {
      const current = projectRef.current;
      const previous = relationship;
      if (!current || !previous) return;
      const tables: Record<string, ErdTable> = {};
      for (const [key, table] of Object.entries(current.tables)) {
        tables[key] = {
          ...table,
          columns: table.columns.map((c) => {
            if (
              table.name === previous.sourceTable &&
              c.name === previous.sourceColumn
            ) {
              return { ...c, references: null };
            }
            if (table.name === rel.sourceTable && c.name === rel.sourceColumn) {
              return {
                ...c,
                references: {
                  schema: current.schemaName,
                  table: rel.targetTable,
                  column: rel.targetColumn,
                },
              };
            }
            return c;
          }),
        };
      }
      commitProject({ ...current, tables });
      markErdFeature("edit-relationships");
      toast.success("Relationship updated");
    },
    [commitProject, relationship],
  );

  const handleDeleteRelationship = useCallback(
    (rel: SchemaDiagramRelationship) => {
      const current = projectRef.current;
      if (!current) return;
      const tables: Record<string, ErdTable> = {};
      for (const [key, table] of Object.entries(current.tables)) {
        tables[key] = {
          ...table,
          columns: table.columns.map((c) =>
            table.name === rel.sourceTable && c.name === rel.sourceColumn
              ? { ...c, references: null }
              : c,
          ),
        };
      }
      commitProject({ ...current, tables });
      markErdFeature("edit-relationships");
      toast.success("Relationship deleted");
    },
    [commitProject],
  );

  const handleExportSql = useCallback(async () => {
    const current = projectRef.current;
    if (!current) return;
    const tables = Object.values(current.tables);
    if (tables.length === 0) {
      toast.error("Add at least one table before exporting SQL");
      return;
    }
    const sql = buildSchemaSql(
      tables,
      current.schemaName,
      current.dbType || dbType,
    );
    if (!sql.trim()) {
      toast.error("Nothing to export");
      return;
    }

    const fileName = `${current.name
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "erd"}.sql`;

    try {
      await navigator.clipboard.writeText(sql);
    } catch {
      // Clipboard can fail in some desktop contexts — still try the file download.
    }

    try {
      downloadText(sql, fileName);
      markErdFeature("export-sql");
      toast.success("SQL copied and downloaded");
    } catch (error) {
      // If download is blocked (common in Tauri), clipboard alone is still useful.
      markErdFeature("export-sql");
      toast.success("SQL copied to clipboard");
      console.error("ERD SQL download failed:", error);
    }
  }, [dbType]);

  const handleSave = useCallback(() => {
    const current = projectRef.current;
    if (!current) return;
    commitProject(current, { toastSave: true });
  }, [commitProject]);

  if (!erdId) {
    return (
      <div className="flex h-full items-center justify-center bg-studio-bg text-sm text-muted-foreground">
        Select or create an ERD project from the sidebar.
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-studio-bg text-sm text-muted-foreground">
        ERD project not found. It may have been deleted.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <SchemaDiagram
        mode="editable"
        schemaData={schemaData}
        selectedSchema={project.schemaName}
        dbType={project.dbType || dbType}
        positions={project.positions}
        onPositionsChange={handlePositionsChange}
        onSchemaDataChange={handleSchemaDataChange}
        onAddTable={() => {
          setEditingTableName(null);
          setTableSheetOpen(true);
        }}
        onEditTable={(name) => {
          setEditingTableName(name);
          setTableSheetOpen(true);
        }}
        onDeleteTable={handleDeleteTable}
        onEditRelationship={(rel) => setRelationship(rel)}
        onSave={handleSave}
        onExportSql={handleExportSql}
      />

      <ErdEditTableSheet
        open={tableSheetOpen}
        onOpenChange={setTableSheetOpen}
        schemaName={project.schemaName}
        dbType={project.dbType || dbType}
        initial={editingTable}
        existingNames={existingNames}
        tables={tableList}
        onSubmit={handleSubmitTable}
      />

      <ErdEditRelationshipDialog
        open={Boolean(relationship)}
        onOpenChange={(open) => {
          if (!open) setRelationship(null);
        }}
        tables={tableList}
        initial={relationship}
        onSave={handleSaveRelationship}
        onDelete={handleDeleteRelationship}
      />
    </div>
  );
}
