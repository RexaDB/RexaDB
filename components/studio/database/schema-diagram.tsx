"use client";

import dagre from "@dagrejs/dagre";
import { toPng, toSvg } from "html-to-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Edge,
  type Node,
  type ReactFlowInstance,
  MarkerType,
  ColorMode,
  ConnectionMode,
  ConnectionLineType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Table2 as TableIcon,
  GitFork,
  RefreshCw,
  Key,
  Diamond,
  Check,
  Copy,
  Download,
  EllipsisVertical,
  PencilLine,
  Hash,
  Fingerprint,
  Rows3,
  Loader2,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/providers/theme-provider";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ConnectionDbType } from "@/lib/db/connection-type";

interface Column {
  name: string;
  type: string;
  isPrimary: boolean;
  isNullable: boolean;
  references: {
    schema: string;
    table: string;
    column: string;
  } | null;
}

interface TableData extends Record<string, unknown> {
  schema: string;
  name: string;
  columns: Column[];
  onCopyName?: (tableName: string) => void;
  onCopySql?: (tableName: string) => void;
  onOpenTable?: (tableName: string) => void;
  onFocusTable?: (tableName: string) => void;
}

interface SchemaDiagramProps {
  schemaData: Record<string, TableData>;
  selectedSchema: string;
  schemas?: string[];
  onSchemaChange?: (schema: string) => void;
  dbType?: ConnectionDbType;
  refreshCurrentTab?: () => void;
  setIsAddFKSheetOpen?: (open: boolean) => void;
  setNewFKData?: (data: any) => void;
  onOpenTable?: (tableName: string) => void;
  highlightedTable?: string | null;
}

// Custom Node Component for Tables
const TableNode = ({ data }: { data: TableData }) => {
  const ROW_HEIGHT = 28;
  const HEADER_HEIGHT = 52;
  return (
    <div className="bg-card border border-border rounded-lg shadow-xl overflow-hidden min-w-72 select-none">
      <div className="px-4 h-[52px] bg-studio-header-bg border-b border-border flex items-center justify-between gap-3 group drag-handle cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/20">
            <TableIcon className="w-4 h-4 shrink-0 text-foreground/80" />
          </div>
          <span className="text-sm leading-none font-normal text-foreground tracking-tight truncate">
            {data.name}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="h-8 w-8 shrink-0 rounded-lg border border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors flex items-center justify-center pointer-events-auto"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <EllipsisVertical className="w-4 h-4 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => data.onCopyName?.(data.name)}
              className="gap-2"
            >
              <Copy className="w-4 h-4" />
              Copy name
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => data.onCopySql?.(data.name)}
              className="gap-2"
            >
              <PencilLine className="w-4 h-4" />
              Copy SQL
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => data.onOpenTable?.(data.name)}
              className="gap-2"
            >
              <Rows3 className="w-4 h-4" />
              Table editor
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => data.onFocusTable?.(data.name)}
              className="gap-2"
            >
              <GitFork className="w-4 h-4" />
              Focus in schema
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="divide-y divide-border/60">
        {data.columns.map((col, idx) => {
          const rowIcons = [
            col.isPrimary ? (
              <Key
                key="pk"
                className="w-3.5 h-3.5 shrink-0 text-warning/85 -rotate-45"
              />
            ) : null,
            isIdentityColumn(col) ? (
              <Hash
                key="identity"
                className="w-3.5 h-3.5 shrink-0 text-foreground/55"
              />
            ) : null,
            isUniqueColumn(col) ? (
              <Fingerprint
                key="unique"
                className="w-3.5 h-3.5 shrink-0 text-foreground/55"
              />
            ) : null,
            col.isNullable ? (
              <Diamond
                key="nullable"
                className="w-3.5 h-3.5 shrink-0 text-foreground/55"
              />
            ) : (
              <Diamond
                key="non-nullable"
                className={`w-3.5 h-3.5 shrink-0 ${col.references ? "text-primary/70" : "text-foreground/75"} fill-current`}
              />
            ),
          ].filter(Boolean);

          return (
            <div
              key={col.name}
              className="pl-3 pr-4 py-0 flex items-center justify-between hover:bg-muted/20 transition-colors group/row relative overflow-hidden h-12"
              data-table={data.name}
              data-col={col.name}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`${col.name}-target`}
                className={`row-handle opacity-0 group-hover/row:opacity-100 transition-opacity duration-150 ${(data.dbType === "postgres" || data.dbType === "supabase-mgmt") ? "" : "pointer-events-none"}`}
                style={{
                  top: HEADER_HEIGHT + idx * ROW_HEIGHT + ROW_HEIGHT / 2,
                  height: ROW_HEIGHT,
                  width: 28,
                }}
              />
              <Handle
                type="source"
                position={Position.Right}
                id={`${col.name}-source`}
                className={`row-handle opacity-0 group-hover/row:opacity-100 transition-opacity duration-150 ${(data.dbType === "postgres" || data.dbType === "supabase-mgmt") ? "" : "pointer-events-none"}`}
                style={{
                  top: HEADER_HEIGHT + idx * ROW_HEIGHT + ROW_HEIGHT / 2,
                  height: ROW_HEIGHT,
                  width: 28,
                }}
              />

              <div className="flex items-center gap-2 min-w-0 relative z-10 pointer-events-none">
                <div className="flex items-center gap-2 shrink-0">
                  {rowIcons.map((icon, index) => (
                    <span
                      key={index}
                      className="flex h-4 w-4 items-center justify-center"
                    >
                      {icon}
                    </span>
                  ))}
                </div>
                <span
                  className={`text-xs leading-none truncate ${col.isPrimary ? "text-foreground/95 font-medium" : "text-foreground/80"}`}
                >
                  {col.name}
                </span>
              </div>
              <span className="text-xs text-muted-foreground/50 font-mono lowercase shrink-0 ml-4 group-hover/row:text-muted-foreground/70 transition-colors relative z-10 pointer-events-none tracking-[0.18em]">
                {col.type}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const nodeTypes = {
  table: TableNode,
};

const TABLE_NODE_WIDTH = 288;
const DAGRE_NODE_SEP = 72;
const DAGRE_RANK_SEP = 120;

export function SchemaDiagram({
  schemaData,
  selectedSchema,
  schemas = [],
  onSchemaChange,
  dbType = "postgres",
  refreshCurrentTab,
  setIsAddFKSheetOpen,
  setNewFKData,
  onOpenTable,
  highlightedTable,
}: SchemaDiagramProps) {
  const { theme, systemTheme } = useTheme();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [copied, setCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"grid" | "auto">("auto");
  const dragSourceRef = useRef<{ table: string; column: string } | null>(null);
  const connectHandledRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<Node<TableData>, Edge> | null>(
    null,
  );
  const [layoutWidth, setLayoutWidth] = useState(1200);
  const lastLayoutKeyRef = useRef<string>("");
  const lastLayoutWidthRef = useRef<number>(0);
  const lastLayoutSchemaRef = useRef<string>("");
  const lastLayoutDataHashRef = useRef<string>("");
  const lastMeasuredHashRef = useRef<string>("");
  const layoutTokenRef = useRef(0);
  const measuredSizesRef = useRef<
    Map<string, { width: number; height: number }>
  >(new Map());

  const currentTheme = (theme === "system" ? systemTheme : theme) as ColorMode;

  // color-mix works with whatever format --primary happens to be (oklch,
  // hex, or a color-mix expression from a custom theme), unlike manually
  // parsing it as hex — which silently fell back to a hardcoded blue
  // whenever the token wasn't a 6-digit hex string (e.g. the default light
  // theme's oklch primary).
  const edgeColor = useMemo(() => {
    const alphaPct = currentTheme === "light" ? "60%" : "40%";
    return `color-mix(in srgb, var(--primary) ${alphaPct}, transparent)`;
  }, [currentTheme]);
  const miniMapNodeColor = "var(--muted-foreground)";
  const miniMapMaskColor = "color-mix(in srgb, var(--studio-bg) 80%, transparent)";

  const filteredTables = useMemo(() => {
    if (!schemaData) return [] as TableData[];
    const schemasInData = Array.from(
      new Set(Object.values(schemaData).map((t: any) => t.schema)),
    );
    console.log(
      "[diagram-filter] selectedSchema:",
      selectedSchema,
      "schemasInData:",
      schemasInData,
      "match:",
      schemasInData.some(
        (s) => s.toLowerCase() === selectedSchema.toLowerCase(),
      ),
    );
    return Object.values(schemaData).filter(
      (t: any) => t.schema.toLowerCase() === selectedSchema.toLowerCase(),
    );
  }, [schemaData, selectedSchema]);

  const sortedTables = useMemo(
    () => [...filteredTables].sort((a, b) => a.name.localeCompare(b.name)),
    [filteredTables],
  );

  useEffect(() => {
    measuredSizesRef.current.clear();
  }, [selectedSchema]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    if (!highlightedTable || !reactFlowRef.current) return;
    const node = nodes.find((n) => n.id === highlightedTable);
    if (node) {
      reactFlowRef.current.fitView({
        nodes: [node],
        duration: 800,
        padding: 0.5,
      });
    }
  }, [highlightedTable, nodes]);

  // Transform schemaData to React Flow nodes and edges
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => setLayoutWidth(node.clientWidth || 1200);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!schemaData) return;
    const token = ++layoutTokenRef.current;

    const dataHash = JSON.stringify(
      sortedTables.map((t) => ({ n: t.name, c: t.columns.length })),
    );
    const isSchemaChange = selectedSchema !== lastLayoutSchemaRef.current;
    const isDataChange = dataHash !== lastLayoutDataHashRef.current;
    const isWidthChange = layoutWidth !== lastLayoutWidthRef.current;

    // If only width changed and we are in auto mode, skip re-layout to preserve manual positions
    if (
      layoutMode === "auto" &&
      isWidthChange &&
      !isSchemaChange &&
      !isDataChange
    ) {
      lastLayoutWidthRef.current = layoutWidth;
      return;
    }

    lastLayoutSchemaRef.current = selectedSchema;
    lastLayoutDataHashRef.current = dataHash;
    lastLayoutWidthRef.current = layoutWidth;

    const runLayout = () => {
      if (token !== layoutTokenRef.current) return;
      const start = performance.now();

      let newNodes: Node<TableData>[] = [];

      const sizeMap = <T,>(extract: (s: { width: number; height: number }) => T) =>
        new Map(Array.from(measuredSizesRef.current.entries()).map(([id, size]) => [id, extract(size)]));

      const sharedLayoutOpts = {
        dbType,
        heightById: sizeMap((s) => s.height),
        onOpenTable,
        onFocusTable: makeFocusNodeHandler(reactFlowRef),
        selectedSchema,
        tables: sortedTables,
        widthById: sizeMap((s) => s.width),
      };

      if (layoutMode === "auto") {
        newNodes = getLayoutedElementsViaDagre(sharedLayoutOpts);
      } else {
        newNodes = getLayoutedElementsViaGrid({ ...sharedLayoutOpts, layoutWidth });
      }

      const newEdges: Edge[] = [];
      filteredTables.forEach((table) => {
        table.columns.forEach((col) => {
          if (col.references && col.references.schema === selectedSchema) {
            newEdges.push({
              id: `e-${table.name}-${col.name}-${col.references.table}-${col.references.column}`,
              source: table.name,
              target: col.references.table,
              sourceHandle: `${col.name}-source`,
              targetHandle: `${col.references.column}-target`,
              animated: false,
              type: "smoothstep",
              style: {
                stroke: edgeColor,
                strokeWidth: 1.5,
                strokeDasharray: "6,4",
              },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 12,
                height: 12,
                color: edgeColor,
              },
            });
          }
        });
      });

      if (token !== layoutTokenRef.current) return;
      console.log("[schema-layout] done", {
        token,
        tables: sortedTables.length,
        edges: newEdges.length,
        durationMs: Math.round(performance.now() - start),
      });
      setNodes(newNodes);
      setEdges(newEdges);

      // Center the view after a layout change
      if (isSchemaChange || isDataChange) {
        window.requestAnimationFrame(() => {
          reactFlowRef.current?.fitView({ duration: 400, padding: 0.2 });
        });
      }
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = (
        window as Window & {
          requestIdleCallback?: (
            cb: () => void,
            opts?: { timeout: number },
          ) => number;
        }
      ).requestIdleCallback?.(runLayout, { timeout: 2000 });
      return () => {
        layoutTokenRef.current += 1;
        if (typeof idleId === "number" && "cancelIdleCallback" in window) {
          (
            window as Window & { cancelIdleCallback?: (id: number) => void }
          ).cancelIdleCallback?.(idleId);
        }
      };
    }
    const timeoutId = globalThis.setTimeout(runLayout, 0);
    return () => {
      layoutTokenRef.current += 1;
      globalThis.clearTimeout(timeoutId);
    };
  }, [
    schemaData,
    setNodes,
    setEdges,
    edgeColor,
    dbType,
    layoutWidth,
    filteredTables,
    sortedTables,
    selectedSchema,
    onOpenTable,
    layoutMode,
  ]);

  useEffect(() => {
    // Skip automatic Dagre re-layout to keep the UI responsive.
  }, []);

  const applyAutoLayout = useCallback(() => {
    setLayoutMode("auto");
    const measured = collectMeasuredSizes(containerRef.current);
    if (measured.size === 0) return;
    measuredSizesRef.current = measured;

    setNodes(
      getLayoutedElementsViaDagre({
        dbType,
        heightById: new Map(
          Array.from(measured.entries()).map(([id, size]) => [id, size.height]),
        ),
        onOpenTable,
        selectedSchema,
        tables: sortedTables,
        widthById: new Map(
          Array.from(measured.entries()).map(([id, size]) => [id, size.width]),
        ),
      }),
    );

    window.requestAnimationFrame(() => {
      reactFlowRef.current?.fitView({ duration: 400, padding: 0.2 });
    });
  }, [dbType, onOpenTable, selectedSchema, setNodes, sortedTables]);

  const copySchemaAsSql = useCallback(async () => {
    if (
      dbType === "mongodb" ||
      dbType === "redis" ||
      dbType === "spacetimedb"
    ) {
      toast.info("Copy as SQL is available for relational schemas only");
      return;
    }

    try {
      const sql = buildSchemaSql(sortedTables, selectedSchema, dbType);
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      toast.success("Schema SQL copied");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to copy schema SQL",
      );
    }
  }, [dbType, selectedSchema, sortedTables]);

  const downloadImage = useCallback(
    async (format: "png" | "svg") => {
      const reactFlowViewport = containerRef.current?.querySelector(
        ".react-flow__viewport",
      ) as HTMLElement | null;
      if (!reactFlowViewport) return;

      setIsDownloading(true);

      try {
        const width = reactFlowViewport.clientWidth;
        const height = reactFlowViewport.clientHeight;
        const { x, y, zoom } = reactFlowRef.current?.getViewport() ?? {
          x: 0,
          y: 0,
          zoom: 1,
        };

        // Resolve the actual canvas background from the theme so exports
        // match what the user sees (including custom themes), instead of
        // hardcoding #ffffff / #111111.
        const exportBg =
          (containerRef.current &&
            getComputedStyle(containerRef.current).backgroundColor) ||
          getComputedStyle(document.documentElement)
            .getPropertyValue("--studio-bg")
            .trim() ||
          (currentTheme === "light" ? "#ffffff" : "#111111");

        if (format === "svg") {
          const data = await toSvg(reactFlowViewport, {
            cacheBust: true,
            backgroundColor: exportBg,
            width,
            height,
            style: {
              width: width.toString(),
              height: height.toString(),
              transform: `translate(${x}px, ${y}px) scale(${zoom})`,
            },
          });
          downloadDataUrl(data, `schema-${selectedSchema}.svg`);
        } else {
          const data = await toPng(reactFlowViewport, {
            cacheBust: true,
            backgroundColor: exportBg,
            pixelRatio: 2,
            width,
            height,
            style: {
              width: width.toString(),
              height: height.toString(),
              transform: `translate(${x}px, ${y}px) scale(${zoom})`,
            },
          });
          downloadDataUrl(data, `schema-${selectedSchema}.png`);
        }

        toast.success(`Successfully downloaded as ${format.toUpperCase()}`);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to export current view",
        );
      } finally {
        setIsDownloading(false);
      }
    },
    [currentTheme, selectedSchema],
  );

  if (Object.keys(schemaData || {}).length === 0) {
    const isMongo = dbType === "mongodb";
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-studio-bg overflow-hidden relative">
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="z-10 text-center space-y-4 max-w-md px-6">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-primary/20">
            <GitFork className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">
            {isMongo ? "No Collections Found" : "No Tables Found"}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {isMongo ? (
              <>
                There are no collections in the{" "}
                <code className="bg-muted px-1 rounded">{selectedSchema}</code>{" "}
                database to visualize.
              </>
            ) : (
              <>
                There are no tables in the{" "}
                <code className="bg-muted px-1 rounded">{selectedSchema}</code>{" "}
                schema to visualize.
              </>
            )}
          </p>
          {refreshCurrentTab && (
            <Button
              onClick={() => refreshCurrentTab()}
              variant="outline"
              className="mt-4 gap-2 border-primary/20 hover:bg-primary/5 hover:text-primary hover:border-primary/40"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh Schema
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-studio-bg overflow-hidden relative w-full h-full"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onInit={(instance) => {
          reactFlowRef.current = instance;
        }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{
          stroke: edgeColor,
          strokeWidth: 1.5,
          strokeDasharray: "6,4",
        }}
        connectionRadius={48}
        onConnectStart={(_, params) => {
          connectHandledRef.current = false;
          if (dbType !== "postgres") return;
          const table = params.nodeId || "";
          const handleId = params.handleId || "";
          const column = handleId.replace(/-source$|-target$/, "");
          if (table && column) {
            dragSourceRef.current = { table, column };
          } else {
            dragSourceRef.current = null;
          }
        }}
        onConnect={(params) => {
          if (dbType !== "postgres") {
            toast.info("Relationship creation is available for Postgres only");
            return;
          }
          if (!setIsAddFKSheetOpen || !setNewFKData) {
            toast.error("Foreign key creation is not enabled in this view");
            return;
          }

          const sourceTable = params.source;
          const targetTable = params.target;
          const sourceColumn = params.sourceHandle?.replace(
            /-source$|-target$/,
            "",
          );
          const targetColumn = params.targetHandle?.replace(
            /-source$|-target$/,
            "",
          );

          if (sourceTable && targetTable && sourceColumn && targetColumn) {
            connectHandledRef.current = true;
            setNewFKData({
              sourceSchema: selectedSchema,
              sourceTable,
              sourceColumn,
              targetSchema: selectedSchema,
              targetTable,
              targetColumn,
            });
            setIsAddFKSheetOpen(true);
          } else {
            toast.error(
              "Could not detect columns. Drag from a column to another column.",
            );
          }
        }}
        onConnectEnd={(event) => {
          if (dbType !== "postgres") return;
          if (connectHandledRef.current) {
            dragSourceRef.current = null;
            connectHandledRef.current = false;
            return;
          }
          const src = dragSourceRef.current;
          dragSourceRef.current = null;
          if (!src) return;
          const pt =
            "clientX" in event
              ? {
                  x: (event as MouseEvent).clientX,
                  y: (event as MouseEvent).clientY,
                }
              : null;
          if (!pt) return;
          const el = document.elementFromPoint(pt.x, pt.y);
          if (!el) return;
          const rowEl =
            (el.closest?.("[data-table][data-col]") as HTMLElement | null) ||
            null;
          if (!rowEl) return;
          const targetTable = rowEl.getAttribute("data-table") || "";
          const targetColumn = rowEl.getAttribute("data-col") || "";
          if (!targetTable || !targetColumn) return;
          if (targetTable === src.table) return;
          if (!setIsAddFKSheetOpen || !setNewFKData) return;

          setNewFKData({
            sourceSchema: selectedSchema,
            sourceTable: src.table,
            sourceColumn: src.column,
            targetSchema: selectedSchema,
            targetTable,
            targetColumn,
            // Remaining fields filled in the sheet
          } as any);
          setIsAddFKSheetOpen(true);
        }}
        isValidConnection={(connection) => {
          if (dbType !== "postgres") return false;
          if (connection.source === connection.target) return false;
          return true;
        }}
        proOptions={{ hideAttribution: true }}
        colorMode={currentTheme}
        minZoom={0.2}
        maxZoom={2}
        fitView
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.2}
          color={`color-mix(in srgb, var(--muted-foreground) ${currentTheme === "light" ? "18%" : "14%"}, transparent)`}
          className="opacity-90"
        />
        <Controls
          showInteractive={false}
          className="bg-card border-border fill-foreground/50"
        />
        <MiniMap
          pannable
          zoomable
          nodeColor={miniMapNodeColor}
          maskColor={miniMapMaskColor}
          className="border rounded-lg shadow-sm bg-card"
        />

        {refreshCurrentTab && (
          <Panel position="top-right">
            <div className="flex items-center gap-2">
              {schemas.length > 0 && onSchemaChange && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 bg-background border-border hover:bg-muted/40 text-xs gap-2 shadow-sm min-w-[120px] justify-between"
                    >
                      <span className="truncate">{selectedSchema}</span>
                      <EllipsisVertical className="w-3 h-3 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-48 max-h-80 overflow-y-auto"
                  >
                    {schemas.map((s) => (
                      <DropdownMenuItem
                        key={s}
                        onClick={() => onSchemaChange(s)}
                        className="gap-2"
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-lg ${s === selectedSchema ? "bg-primary" : "bg-transparent"}`}
                        />
                        {s}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                onClick={() => void copySchemaAsSql()}
                variant="outline"
                size="sm"
                className="h-8 bg-background border-border hover:bg-muted/40 text-xs gap-2 shadow-sm"
              >
                {copied ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                Copy SQL
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isDownloading}
                    className="h-8 bg-background border-border hover:bg-muted/40 text-xs gap-2 shadow-sm"
                  >
                    {isDownloading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Download className="w-3 h-3" />
                    )}
                    {isDownloading ? "Exporting..." : "Download"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => void downloadImage("png")}>
                    Download as PNG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void downloadImage("svg")}>
                    Download as SVG
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="flex items-center bg-background border border-border rounded-lg p-0.5 shadow-sm">
                <Button
                  onClick={applyAutoLayout}
                  variant={layoutMode === "auto" ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-xs font-medium transition-all",
                    layoutMode === "auto"
                      ? "bg-muted shadow-sm"
                      : "hover:bg-muted/50",
                  )}
                >
                  Auto
                </Button>
                <Button
                  onClick={() => setLayoutMode("grid")}
                  variant={layoutMode === "grid" ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-xs font-medium transition-all",
                    layoutMode === "grid"
                      ? "bg-muted shadow-sm"
                      : "hover:bg-muted/50",
                  )}
                >
                  Grid
                </Button>
              </div>
              <Button
                onClick={() => refreshCurrentTab()}
                variant="outline"
                size="sm"
                className="h-8 bg-background border-border hover:bg-muted/40 text-xs gap-2 shadow-sm"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh
              </Button>
            </div>
          </Panel>
        )}
      </ReactFlow>
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
        <div className="bg-card/80 backdrop-blur-md border border-border rounded-lg px-2 py-1 shadow-xl flex items-center gap-1">
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground/60 flex items-center gap-2 hover:text-foreground transition-colors cursor-default">
            <div className="w-1.5 h-1.5 rounded-lg bg-primary/50" />
            Relationships
          </div>
          <div className="w-px h-3 bg-border/80" />
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground/60 flex items-center gap-2 hover:text-foreground transition-colors cursor-default">
            <Key className="w-3 h-3 text-warning/85 -rotate-45" />
            Primary key
          </div>
          <div className="w-px h-3 bg-border/80" />
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground/60 flex items-center gap-2 hover:text-foreground transition-colors cursor-default">
            <Hash className="w-3 h-3 text-foreground/55" />
            Identity
          </div>
          <div className="w-px h-3 bg-border/80" />
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground/60 flex items-center gap-2 hover:text-foreground transition-colors cursor-default">
            <Fingerprint className="w-3 h-3 text-foreground/55" />
            Unique
          </div>
          <div className="w-px h-3 bg-border/80" />
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground/60 flex items-center gap-2 hover:text-foreground transition-colors cursor-default">
            <Diamond className="w-3 h-3 text-foreground/55" />
            Nullable
          </div>
          <div className="w-px h-3 bg-border/80" />
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground/60 flex items-center gap-2 hover:text-foreground transition-colors cursor-default">
            <Diamond className="w-3 h-3 text-foreground/75 fill-current" />
            Non-nullable
          </div>
        </div>
      </div>
    </div>
  );
}

function makeCopyNameHandler() {
  return (name: string) => {
    void navigator.clipboard.writeText(name);
    toast.success("Table name copied");
  };
}

function makeCopySqlHandler(
  tables: TableData[],
  selectedSchema: string,
  dbType: ConnectionDbType,
) {
  return (name: string) => {
    const target = tables.find((entry) => entry.name === name);
    if (!target) return;
    void navigator.clipboard.writeText(
      buildTableSql(target, selectedSchema, dbType),
    );
    toast.success("Table SQL copied");
  };
}

function makeFocusNodeHandler(reactFlowRef: {
  current: ReactFlowInstance<Node<TableData>, Edge> | null;
}) {
  return (tableName: string) => {
    const node = reactFlowRef.current?.getNode(tableName);
    if (node) {
      reactFlowRef.current?.fitView({
        nodes: [node],
        duration: 800,
        padding: 0.5,
      });
    }
  };
}

function buildSchemaSql(
  tables: TableData[],
  selectedSchema: string,
  dbType: ConnectionDbType,
) {
  return tables
    .map((table) => buildTableSql(table, selectedSchema, dbType))
    .join("\n\n");
}

function collectMeasuredSizes(
  container: HTMLElement | null,
): Map<string, { width: number; height: number }> {
  if (!container) return new Map();
  const measured = new Map<string, { width: number; height: number }>();
  const nodeEls = container.querySelectorAll<HTMLElement>(".react-flow__node");
  nodeEls.forEach((el) => {
    const id = el.getAttribute("data-id") || "";
    if (!id) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (width > 0 && height > 0) {
      measured.set(id, { width, height });
    }
  });
  return measured;
}

function makeLayoutNodes(
  tables: TableData[],
  dbType: ConnectionDbType,
  selectedSchema: string,
  onOpenTable?: (tableName: string) => void,
  onFocusTable?: (tableName: string) => void,
): Node<TableData>[] {
  return tables.map((table) => ({
    id: table.name,
    type: "table",
    position: { x: 0, y: 0 },
    dragHandle: ".drag-handle",
    data: makeNodeData(
      table,
      dbType,
      tables,
      selectedSchema,
      onOpenTable,
      onFocusTable,
    ),
  }));
}

function makeNodeData(
  table: TableData,
  dbType: ConnectionDbType,
  tables: TableData[],
  selectedSchema: string,
  onOpenTable?: (tableName: string) => void,
  onFocusTable?: (tableName: string) => void,
): TableData {
  return {
    ...table,
    dbType,
    onCopyName: makeCopyNameHandler(),
    onCopySql: makeCopySqlHandler(tables, selectedSchema, dbType),
    onOpenTable: (name: string) => {
      onOpenTable?.(name);
    },
    onFocusTable: (name: string) => {
      onFocusTable?.(name);
    },
  };
}

function buildDagreGraph(
  tables: TableData[],
  selectedSchema: string,
  graphConfig: Record<string, any>,
  widthById: Map<string, number>,
  heightById: Map<string, number>,
) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph(graphConfig);
  tables.forEach((table) => {
    const nodeWidth = widthById.get(table.name) ?? TABLE_NODE_WIDTH;
    const nodeHeight = heightById.get(table.name) ?? estimateTableHeight(table);
    dagreGraph.setNode(table.name, { width: nodeWidth, height: nodeHeight });
  });
  addEdgesToDagreGraph(dagreGraph, tables, selectedSchema);
  dagre.layout(dagreGraph);
  return dagreGraph;
}

function addEdgesToDagreGraph(
  dagreGraph: dagre.graphlib.Graph,
  tables: TableData[],
  selectedSchema: string,
) {
  tables.forEach((table) => {
    table.columns.forEach((column) => {
      if (!column.references || column.references.schema !== selectedSchema)
        return;
      if (
        !tables.some((candidate) => candidate.name === column.references?.table)
      )
        return;
      dagreGraph.setEdge(table.name, column.references.table);
    });
  });
}

function getLayoutedElementsViaGrid({
  dbType,
  heightById,
  layoutWidth,
  onOpenTable,
  onFocusTable,
  selectedSchema,
  tables,
  widthById,
}: {
  dbType: ConnectionDbType;
  heightById: Map<string, number>;
  layoutWidth: number;
  onOpenTable?: (tableName: string) => void;
  onFocusTable?: (tableName: string) => void;
  selectedSchema: string;
  tables: TableData[];
  widthById: Map<string, number>;
}) {
  const prebuiltNodes = makeLayoutNodes(tables, dbType, selectedSchema, onOpenTable, onFocusTable);
  const dagreGraph = buildDagreGraph(
    tables,
    selectedSchema,
    {
      rankdir: "LR",
      nodesep: DAGRE_NODE_SEP,
      ranksep: DAGRE_RANK_SEP,
    },
    widthById,
    heightById,
  );

  const nodesByRank: Record<number, string[]> = {};
  tables.forEach((t) => {
    const dNode = dagreGraph.node(t.name);
    const rank = (dNode as any).rank ?? 0;
    if (!nodesByRank[rank]) nodesByRank[rank] = [];
    nodesByRank[rank].push(t.name);
  });

  const ranks = Object.keys(nodesByRank)
    .map(Number)
    .sort((a, b) => a - b);

  ranks.forEach((rank) => {
    nodesByRank[rank].sort((a, b) => {
      const dNodeA = dagreGraph.node(a);
      const dNodeB = dagreGraph.node(b);
      return dNodeA.y - dNodeB.y;
    });
  });

  const GRID_COL_SEP = 240; // Increased spacing to allow lines to pass
  const GRID_ROW_SEP = 120;

  const colWidth = TABLE_NODE_WIDTH + GRID_COL_SEP;
  const rowHeights: number[] = [];

  const nodeDataByName = new Map(prebuiltNodes.map((n) => [n.id, n.data]));
  const tableMap = new Map(tables.map((t) => [t.name, t]));

  ranks.forEach((rank, colIdx) => {
    nodesByRank[rank].forEach((tableName, rowIdx) => {
      const table = tableMap.get(tableName)!;
      const height = heightById.get(tableName) ?? estimateTableHeight(table);
      rowHeights[rowIdx] = Math.max(rowHeights[rowIdx] ?? 0, height);
    });
  });

  const rowOffsets: number[] = [];
  rowHeights.forEach((height, idx) => {
    rowOffsets[idx] =
      (rowOffsets[idx - 1] ?? 0) +
      (idx === 0 ? 0 : rowHeights[idx - 1] + GRID_ROW_SEP);
  });

  const nodes: Node<TableData>[] = [];
  ranks.forEach((rank, colIdx) => {
    nodesByRank[rank].forEach((tableName, rowIdx) => {
      nodes.push({
        id: tableName,
        type: "table",
        position: {
          x: colIdx * colWidth,
          y: rowOffsets[rowIdx] ?? 0,
        },
        targetPosition: Position.Left,
        sourcePosition: Position.Right,
        dragHandle: ".drag-handle",
        data: nodeDataByName.get(tableName)!,
      });
    });
  });

  return nodes;
}

function getLayoutedElementsViaDagre({
  dbType,
  heightById,
  onOpenTable,
  onFocusTable,
  selectedSchema,
  tables,
  widthById,
}: {
  dbType: ConnectionDbType;
  heightById: Map<string, number>;
  onOpenTable?: (tableName: string) => void;
  onFocusTable?: (tableName: string) => void;
  selectedSchema: string;
  tables: TableData[];
  widthById: Map<string, number>;
}) {
  const nodes: Node<TableData>[] = makeLayoutNodes(tables, dbType, selectedSchema, onOpenTable, onFocusTable);

  const heightByIdWithPadding = new Map<string, number>();
  const widthByIdWithPadding = new Map<string, number>();
  nodes.forEach((node) => {
    const w = (widthById.get(node.id) ?? TABLE_NODE_WIDTH) + 24;
    const h = (heightById.get(node.id) ?? estimateTableHeight(node.data)) + 24;
    widthByIdWithPadding.set(node.id, w);
    heightByIdWithPadding.set(node.id, h);
  });

  const dagreGraph = buildDagreGraph(
    tables,
    selectedSchema,
    {
      rankdir: "LR",
      align: "UR",
      nodesep: DAGRE_NODE_SEP,
      ranksep: DAGRE_RANK_SEP,
      marginx: 0,
      marginy: 0,
    },
    widthByIdWithPadding,
    heightByIdWithPadding,
  );

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;

  nodes.forEach((node) => {
    const positionedNode = dagreGraph.node(node.id);
    if (!positionedNode) return;
    node.targetPosition = Position.Left;
    node.sourcePosition = Position.Right;
    node.position = {
      x: positionedNode.x - positionedNode.width / 2,
      y: positionedNode.y - positionedNode.height / 2,
    };
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
  });

  const offsetX = Number.isFinite(minX) ? Math.max(0, -minX) : 0;
  const offsetY = Number.isFinite(minY) ? Math.max(0, -minY) : 0;

  nodes.forEach((node) => {
    node.position = {
      x: node.position.x + offsetX,
      y: node.position.y + offsetY,
    };
  });

  return nodes;
}

function buildTableSql(
  table: TableData,
  selectedSchema: string,
  dbType: ConnectionDbType,
) {
  const columns = table.columns.map((column) => {
    let line = `  ${quoteIdentifier(column.name, dbType)} ${column.type}`;
    if (!column.isNullable) line += " NOT NULL";
    if (column.references) {
      line += ` REFERENCES ${quoteTableRef(column.references.schema, column.references.table, dbType)} (${quoteIdentifier(column.references.column, dbType)})`;
    }
    return line;
  });

  const primaryKeys = table.columns
    .filter((column) => column.isPrimary)
    .map((column) => quoteIdentifier(column.name, dbType));

  if (primaryKeys.length > 0) {
    columns.push(`  PRIMARY KEY (${primaryKeys.join(", ")})`);
  }

  return `CREATE TABLE ${quoteTableRef(selectedSchema, table.name, dbType)} (\n${columns.join(",\n")}\n);`;
}

function estimateTableHeight(table: TableData) {
  const HEADER_HEIGHT = 52;
  const ROW_HEIGHT = 48;
  const rowCount = Array.isArray(table.columns) ? table.columns.length : 0;
  return HEADER_HEIGHT + rowCount * ROW_HEIGHT + 2;
}

function quoteTableRef(
  schema: string,
  table: string,
  dbType: ConnectionDbType,
) {
  return `${quoteIdentifier(schema, dbType)}.${quoteIdentifier(table, dbType)}`;
}

function quoteIdentifier(value: string, dbType: ConnectionDbType) {
  if (dbType === "mysql" || dbType === "clickhouse") return `\`${value}\``;
  if (dbType === "mssql") return `[${value}]`;
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.click();
}

function isIdentityColumn(column: Column) {
  return /serial|identity|auto_increment/i.test(column.type);
}

function isUniqueColumn(column: Column) {
  return Boolean(column.isPrimary);
}
