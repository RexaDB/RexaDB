"use client";

import dagre from "@dagrejs/dagre";
import { toPng, toSvg } from "html-to-image";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
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
  MoreVertical,
  ArrowRight,
  PencilLine,
  Hash,
  Fingerprint,
  Rows3,
  Loader2,
  Trash2,
} from "@/lib/icon-theme/lucide-react";
import { Badge } from "@/components/ui/badge";
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

export interface SchemaDiagramColumn {
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

/** @deprecated Prefer SchemaDiagramColumn */
type Column = SchemaDiagramColumn;

export interface SchemaDiagramTable extends Record<string, unknown> {
  schema: string;
  name: string;
  columns: Column[];
  onCopyName?: (tableName: string) => void;
  onCopySql?: (tableName: string) => void;
  onOpenTable?: (tableName: string) => void;
  onFocusTable?: (tableName: string) => void;
  onEditTable?: (tableName: string) => void;
  onDeleteTable?: (tableName: string) => void;
  editable?: boolean;
  /** When true, relationship handles stay interactive. */
  allowConnect?: boolean;
}

/** @deprecated Prefer SchemaDiagramTable */
type TableData = SchemaDiagramTable;

export type SchemaDiagramMode = "readonly" | "editable";

export type SchemaDiagramRelationship = {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
};

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
  /** readonly = live DB diagram; editable = ERD designer (local model). */
  mode?: SchemaDiagramMode;
  /** Controlled positions for editable mode (keyed by table name). */
  positions?: Record<string, { x: number; y: number }>;
  onPositionsChange?: (positions: Record<string, { x: number; y: number }>) => void;
  /** Called when the design model changes (editable mode). */
  onSchemaDataChange?: (next: Record<string, TableData>) => void;
  onAddTable?: () => void;
  onEditTable?: (tableName: string) => void;
  onDeleteTable?: (tableName: string) => void;
  onEditRelationship?: (rel: SchemaDiagramRelationship) => void;
  onSave?: () => void;
  onExportSql?: () => void;
  /** Extra toolbar controls rendered in the top-right panel. */
  toolbarExtras?: ReactNode;
}

// ─── Table node, edge & legend ─────────────────────────────────────────
// Ported from Supabase Studio's schema visualizer
// (apps/studio/components/interfaces/Database/Schemas in
// https://github.com/supabase/supabase, Apache-2.0 licensed) and adapted to
// RexaDB's data model. Apache-2.0 code may be included in GPL-3.0 works;
// original Supabase copyright is retained via this notice.

export const TABLE_NODE_WIDTH = 160;
export const TABLE_NODE_ROW_HEIGHT = 22;
const TABLE_NODE_HEADER_HEIGHT = 22;

interface SchemaDiagramContextValue {
  selectedEdge: Edge | null;
  isDownloading: boolean;
}

const SchemaDiagramContext =
  createContext<SchemaDiagramContextValue>({ selectedEdge: null, isDownloading: false });

const useSchemaDiagramContext = () => useContext(SchemaDiagramContext);

type TableNodeProps = NodeProps<Node<TableData>>;

const stripHandleSuffix = (handleId?: string | null) =>
  handleId?.replace(/-source$|-target$/, "");

// Compact Supabase-style table card: 160px wide, 22px header/rows, 8px type,
// icon indicators (PK / nullable / unique / identity), invisible 1px handles
// per column row (still fully interactive for drag-to-connect).
const TableNodeComponent = ({ id, data, targetPosition, sourcePosition }: TableNodeProps) => {
  const { selectedEdge, isDownloading } = useSchemaDiagramContext();
  // Nasty hack to use Handles (required for edge calculations), but not show
  // them in the UI. (Same approach as Supabase.)
  const hiddenNodeConnector =
    "!h-px !w-px !min-w-0 !min-h-0 !cursor-grab !border-0 !opacity-0";
  const itemHeight = "h-[22px]";

  const hasEdgeSelected = selectedEdge?.source === id || selectedEdge?.target === id;
  const isColumnSelected = (colName: string) => {
    if (!selectedEdge || !hasEdgeSelected) return false;
    return (
      stripHandleSuffix(selectedEdge.sourceHandle) === colName ||
      stripHandleSuffix(selectedEdge.targetHandle) === colName
    );
  };

  return (
    <article>
      <div
        className={cn(
          "border-[0.5px] border-border overflow-hidden rounded-[4px] shadow-sm bg-card",
          hasEdgeSelected && "outline outline-1 outline-primary",
        )}
        style={{ width: TABLE_NODE_WIDTH }}
      >
        <header
          className={cn(
            "text-[0.55rem] pl-2 pr-1 bg-muted flex gap-2 items-center justify-between drag-handle cursor-grab active:cursor-grabbing border-b border-border/60",
            itemHeight,
          )}
        >
          <div className="min-w-0 flex shrink gap-x-1 items-center">
            <TableIcon strokeWidth={1} size={12} className="shrink-0 text-muted-foreground" />
            <span
              className="whitespace-nowrap overflow-hidden text-ellipsis text-foreground/90"
              title={data.name}
            >
              {data.name}
            </span>
          </div>
          {!isDownloading && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="px-0 w-[16px] h-[16px] rounded-sm nodrag nopan shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <MoreVertical size={10} />
                  <span className="sr-only">{data.name} actions</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {data.editable ? (
                  <>
                    <DropdownMenuItem
                      onClick={() => data.onEditTable?.(data.name)}
                      className="flex items-center space-x-2 whitespace-nowrap"
                    >
                      <PencilLine size={12} />
                      <p>Edit table</p>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => data.onCopySql?.(data.name)}
                      className="flex items-center space-x-2 whitespace-nowrap"
                    >
                      <Copy size={12} />
                      <p>Copy SQL</p>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => data.onFocusTable?.(data.name)}
                      className="flex items-center space-x-2 whitespace-nowrap"
                    >
                      <GitFork size={12} />
                      <p>Focus in diagram</p>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => data.onDeleteTable?.(data.name)}
                      className="flex items-center space-x-2 whitespace-nowrap text-destructive focus:text-destructive"
                    >
                      <Trash2 size={12} />
                      <p>Delete table</p>
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem
                      onClick={() => data.onCopyName?.(data.name)}
                      className="flex items-center space-x-2 whitespace-nowrap"
                    >
                      <Copy size={12} />
                      <p>Copy name</p>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => data.onCopySql?.(data.name)}
                      className="flex items-center space-x-2 whitespace-nowrap"
                    >
                      <PencilLine size={12} />
                      <p>Copy SQL</p>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => data.onOpenTable?.(data.name)}
                      className="flex items-center space-x-2 whitespace-nowrap"
                    >
                      <Rows3 size={12} />
                      <p>Table editor</p>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => data.onFocusTable?.(data.name)}
                      className="flex items-center space-x-2 whitespace-nowrap"
                    >
                      <GitFork size={12} />
                      <p>Focus in schema</p>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>

        {data.columns.map((col) => (
          <div
            key={col.name}
            data-table={data.name}
            data-col={col.name}
            className={cn(
              "text-[8px] leading-5 relative flex flex-row justify-items-start",
              "bg-card",
              "border-t",
              "border-t-[0.5px] border-border/60",
              "hover:bg-muted/40 transition cursor-default",
              "group",
              "pr-1",
              itemHeight,
            )}
          >
            <div className="gap-[0.24rem] flex mx-2 align-middle items-center justify-start">
              {col.isPrimary && (
                <Key size={8} strokeWidth={1} className="shrink-0 text-muted-foreground" />
              )}
              {col.isNullable ? (
                <Diamond size={8} strokeWidth={1} className="shrink-0 text-muted-foreground" />
              ) : (
                <Diamond
                  size={8}
                  strokeWidth={1}
                  fill="currentColor"
                  className="shrink-0 text-muted-foreground"
                />
              )}
              {isUniqueColumn(col) && (
                <Fingerprint size={8} strokeWidth={1} className="shrink-0 text-muted-foreground" />
              )}
              {isIdentityColumn(col) && (
                <Hash size={8} strokeWidth={1} className="shrink-0 text-muted-foreground" />
              )}
            </div>
            <div className="flex w-full justify-between min-w-0">
              <span
                className={cn(
                  "text-ellipsis overflow-hidden whitespace-nowrap min-w-0 max-w-[80%]",
                  isColumnSelected(col.name) ? "text-primary" : "text-foreground/80",
                )}
                title={col.name}
              >
                {col.name}
              </span>
              <span className="shrink-0 pl-2 pr-1 inline-flex justify-end font-mono text-muted-foreground/60 text-[0.4rem]">
                {col.type}
              </span>
            </div>
            {targetPosition && (
              <Handle
                type="target"
                id={`${col.name}-target`}
                position={targetPosition}
                className={hiddenNodeConnector}
              />
            )}
            {sourcePosition && (
              <Handle
                type="source"
                id={`${col.name}-source`}
                position={sourcePosition}
                className={hiddenNodeConnector}
              />
            )}
          </div>
        ))}
      </div>
    </article>
  );
};

// Custom comparator: xyflow re-renders nodes on selection/drag with new prop
// objects; only the listed props affect rendered output. Selection-driven
// styling is read from context, so `selected` can be safely ignored here.
const TableNode = memo(
  TableNodeComponent,
  (prev, next) =>
    prev.id === next.id &&
    prev.data === next.data &&
    prev.targetPosition === next.targetPosition &&
    prev.sourcePosition === next.sourcePosition,
);

export type SchemaDiagramEdgeData = {
  sourceName: string;
  sourceSchemaName: string;
  sourceColumnName: string;
  targetName: string;
  targetSchemaName: string;
  targetColumnName: string;
};

// Supabase-style edge: smoothstep path, relation badge on selection.
const DefaultEdgeComponent = ({
  id,
  data,
  selected,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
}: EdgeProps<Edge<SchemaDiagramEdgeData>>) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const relation = (data ?? {}) as Partial<SchemaDiagramEdgeData>;
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        className={cn(selected && "stroke-primary")}
      />
      {relation.sourceName && selected && (
        <EdgeLabelRenderer>
          <Badge
            className="absolute pointer-events-none z-50 p-1 rounded-[4px] gap-1 text-[8px] font-mono normal-case"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <span>
              {relation.sourceName}.{relation.sourceColumnName}
            </span>
            <ArrowRight size={10} />
            <span>
              {relation.targetName}.{relation.targetColumnName}
            </span>
          </Badge>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

const DefaultEdge = memo(DefaultEdgeComponent);

// Supabase-style legend: PK / identity / unique / nullable / non-nullable.
const SchemaGraphLegend = () => {
  return (
    <div className="absolute bottom-0 left-0 border-t border-border flex justify-center px-1 py-2 shadow-md bg-card w-full z-10">
      <ul className="flex flex-wrap items-center justify-center gap-4">
        <li className="flex items-center text-xs font-mono gap-1 text-muted-foreground">
          <Key size={15} strokeWidth={1.5} className="shrink-0" />
          Primary key
        </li>
        <li className="flex items-center text-xs font-mono gap-1 text-muted-foreground">
          <Hash size={15} strokeWidth={1.5} className="shrink-0" />
          Identity
        </li>
        <li className="flex items-center text-xs font-mono gap-1 text-muted-foreground">
          <Fingerprint size={15} strokeWidth={1.5} className="shrink-0" />
          Unique
        </li>
        <li className="flex items-center text-xs font-mono gap-1 text-muted-foreground">
          <Diamond size={15} strokeWidth={1.5} className="shrink-0" />
          Nullable
        </li>
        <li className="flex items-center text-xs font-mono gap-1 text-muted-foreground">
          <Diamond size={15} strokeWidth={1.5} fill="currentColor" className="shrink-0" />
          Non-Nullable
        </li>
      </ul>
    </div>
  );
};

const nodeTypes = {
  table: TableNode,
};

const DAGRE_NODE_SEP = 25;
const DAGRE_RANK_SEP = 50;

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
  mode = "readonly",
  positions,
  onPositionsChange,
  onSchemaDataChange,
  onAddTable,
  onEditTable,
  onDeleteTable,
  onEditRelationship,
  onSave,
  onExportSql,
  toolbarExtras,
}: SchemaDiagramProps) {
  const { theme, systemTheme } = useTheme();
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node<TableData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [copied, setCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
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
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const isEditable = mode === "editable";
  const allowConnect =
    isEditable || dbType === "postgres" || dbType === "supabase-mgmt";

  const onNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChangeBase>[0]) => {
      onNodesChangeBase(changes);
      if (!isEditable || !onPositionsChange) return;
      const hasPositionChange = changes.some(
        (c) => c.type === "position" && "position" in c && c.dragging === false,
      );
      if (!hasPositionChange) return;
      // Defer so React Flow state has the latest node positions.
      window.requestAnimationFrame(() => {
        const instance = reactFlowRef.current;
        if (!instance) return;
        const next: Record<string, { x: number; y: number }> = {
          ...(positionsRef.current ?? {}),
        };
        for (const node of instance.getNodes()) {
          next[node.id] = { x: node.position.x, y: node.position.y };
        }
        onPositionsChange(next);
      });
    },
    [isEditable, onNodesChangeBase, onPositionsChange],
  );

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
  const edgeTypes = useMemo(() => ({ default: DefaultEdge }), []);

  const diagramContext = useMemo<SchemaDiagramContextValue>(
    () => ({ selectedEdge, isDownloading }),
    [selectedEdge, isDownloading],
  );

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
        onEditTable,
        onDeleteTable,
        editable: isEditable,
        allowConnect,
        selectedSchema,
        tables: sortedTables,
        widthById: sizeMap((s) => s.width),
      };

      if (layoutMode === "auto") {
        newNodes = getLayoutedElementsViaDagre(sharedLayoutOpts);
      } else {
        newNodes = getLayoutedElementsViaGrid({ ...sharedLayoutOpts, layoutWidth });
      }

      // Prefer saved designer positions so rearranging survives reloads.
      const savedPositions = positionsRef.current;
      if (savedPositions && Object.keys(savedPositions).length > 0) {
        newNodes = newNodes.map((node) => {
          const pos = savedPositions[node.id];
          return pos ? { ...node, position: { x: pos.x, y: pos.y } } : node;
        });
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
              type: "default",
              style: {
                stroke: edgeColor,
                strokeWidth: 1.5,
              },
              data: {
                sourceName: table.name,
                sourceSchemaName: selectedSchema,
                sourceColumnName: col.name,
                targetName: col.references.table,
                targetSchemaName: col.references.schema,
                targetColumnName: col.references.column,
              },
              selectable: true,
              focusable: true,
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
    onEditTable,
    onDeleteTable,
    layoutMode,
    isEditable,
    allowConnect,
  ]);

  useEffect(() => {
    // Skip automatic Dagre re-layout to keep the UI responsive.
  }, []);

  const applyAutoLayout = useCallback(() => {
    setLayoutMode("auto");
    const measured = collectMeasuredSizes(containerRef.current);
    if (measured.size === 0) return;
    measuredSizesRef.current = measured;

    const laidOut = getLayoutedElementsViaDagre({
      dbType,
      heightById: new Map(
        Array.from(measured.entries()).map(([id, size]) => [id, size.height]),
      ),
      onOpenTable,
      onEditTable,
      onDeleteTable,
      editable: isEditable,
      allowConnect,
      selectedSchema,
      tables: sortedTables,
      widthById: new Map(
        Array.from(measured.entries()).map(([id, size]) => [id, size.width]),
      ),
    });
    setNodes(laidOut);
    if (isEditable && onPositionsChange) {
      const next: Record<string, { x: number; y: number }> = {};
      for (const node of laidOut) {
        next[node.id] = { x: node.position.x, y: node.position.y };
      }
      onPositionsChange(next);
    }

    window.requestAnimationFrame(() => {
      reactFlowRef.current?.fitView({ duration: 400, padding: 0.2 });
    });
  }, [
    allowConnect,
    dbType,
    isEditable,
    onDeleteTable,
    onEditTable,
    onOpenTable,
    onPositionsChange,
    selectedSchema,
    setNodes,
    sortedTables,
  ]);

  const applyDesignRelationship = useCallback(
    (rel: SchemaDiagramRelationship) => {
      if (!onSchemaDataChange || !schemaData) return;
      const next: Record<string, TableData> = {};
      for (const [key, table] of Object.entries(schemaData)) {
        if (!table) continue;
        if (table.name !== rel.sourceTable) {
          next[key] = table;
          continue;
        }
        next[key] = {
          ...table,
          columns: table.columns.map((col) =>
            col.name === rel.sourceColumn
              ? {
                  ...col,
                  references: {
                    schema: selectedSchema,
                    table: rel.targetTable,
                    column: rel.targetColumn,
                  },
                }
              : col,
          ),
        };
      }
      onSchemaDataChange(next);
    },
    [onSchemaDataChange, schemaData, selectedSchema],
  );

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
            {isEditable
              ? "Start your ERD"
              : isMongo
                ? "No Collections Found"
                : "No Tables Found"}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {isEditable ? (
              <>
                Add tables visually, define columns and relationships, then
                export SQL when you are ready.
              </>
            ) : isMongo ? (
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
          {isEditable && onAddTable ? (
            <Button
              onClick={onAddTable}
              variant="outline"
              className="mt-4 gap-2 border-primary/20 hover:bg-primary/5 hover:text-primary hover:border-primary/40"
            >
              <PencilLine className="w-4 h-4" />
              Add table
            </Button>
          ) : refreshCurrentTab ? (
            <Button
              onClick={() => refreshCurrentTab()}
              variant="outline"
              className="mt-4 gap-2 border-primary/20 hover:bg-primary/5 hover:text-primary hover:border-primary/40"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh Schema
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <SchemaDiagramContext.Provider value={diagramContext}>
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
        onSelectionChange={({ edges: selected }) => setSelectedEdge(selected[0] ?? null)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{
          stroke: edgeColor,
          strokeWidth: 1.5,
        }}
        connectionRadius={48}
        onEdgeClick={
          isEditable
            ? (_event, edge) => {
                const sourceColumn = edge.sourceHandle?.replace(
                  /-source$|-target$/,
                  "",
                );
                const targetColumn = edge.targetHandle?.replace(
                  /-source$|-target$/,
                  "",
                );
                if (
                  !edge.source ||
                  !edge.target ||
                  !sourceColumn ||
                  !targetColumn
                )
                  return;
                onEditRelationship?.({
                  sourceTable: edge.source,
                  sourceColumn,
                  targetTable: edge.target,
                  targetColumn,
                });
              }
            : undefined
        }
        onConnectStart={(_, params) => {
          connectHandledRef.current = false;
          if (!allowConnect) return;
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

          if (!(sourceTable && targetTable && sourceColumn && targetColumn)) {
            toast.error(
              "Could not detect columns. Drag from a column to another column.",
            );
            return;
          }

          connectHandledRef.current = true;

          if (isEditable) {
            applyDesignRelationship({
              sourceTable,
              sourceColumn,
              targetTable,
              targetColumn,
            });
            toast.success("Relationship added");
            return;
          }

          if (dbType !== "postgres" && dbType !== "supabase-mgmt") {
            toast.info("Relationship creation is available for Postgres only");
            return;
          }
          if (!setIsAddFKSheetOpen || !setNewFKData) {
            toast.error("Foreign key creation is not enabled in this view");
            return;
          }

          setNewFKData({
            sourceSchema: selectedSchema,
            sourceTable,
            sourceColumn,
            targetSchema: selectedSchema,
            targetTable,
            targetColumn,
          });
          setIsAddFKSheetOpen(true);
        }}
        onConnectEnd={(event) => {
          if (!allowConnect) return;
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

          if (isEditable) {
            applyDesignRelationship({
              sourceTable: src.table,
              sourceColumn: src.column,
              targetTable,
              targetColumn,
            });
            toast.success("Relationship added");
            return;
          }

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
          if (!allowConnect) return false;
          if (connection.source === connection.target) return false;
          return true;
        }}
        nodesDraggable
        nodesConnectable={allowConnect}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        colorMode={currentTheme}
        style={{ "--xy-background-color": "transparent" } as React.CSSProperties}
        minZoom={0.2}
        maxZoom={2}
        fitView
      >
        <Background gap={16} color="var(--border)" />
        <Controls
          showInteractive={false}
          position="top-left"
          className="bg-card border-border fill-foreground/50"
        />
        <SchemaGraphLegend />

        {(refreshCurrentTab || isEditable) && (
          <Panel position="top-right">
            <div className="flex items-center gap-2">
              {isEditable && onAddTable && (
                <Button
                  onClick={onAddTable}
                  variant="outline"
                  size="sm"
                  className="h-8 bg-background border-border hover:bg-muted/40 text-xs gap-2 shadow-sm"
                >
                  <PencilLine className="w-3 h-3" />
                  Add table
                </Button>
              )}
              {!isEditable && schemas.length > 0 && onSchemaChange && (
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
                onClick={() => {
                  if (onExportSql) onExportSql();
                  else void copySchemaAsSql();
                }}
                variant="outline"
                size="sm"
                className="h-8 bg-background border-border hover:bg-muted/40 text-xs gap-2 shadow-sm"
              >
                {copied ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                {isEditable ? "Export SQL" : "Copy SQL"}
              </Button>
              {isEditable && onSave && (
                <Button
                  onClick={onSave}
                  variant="outline"
                  size="sm"
                  className="h-8 bg-background border-border hover:bg-muted/40 text-xs gap-2 shadow-sm"
                >
                  <Check className="w-3 h-3" />
                  Save
                </Button>
              )}
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
              {!isEditable && refreshCurrentTab && (
                <Button
                  onClick={() => refreshCurrentTab()}
                  variant="outline"
                  size="sm"
                  className="h-8 bg-background border-border hover:bg-muted/40 text-xs gap-2 shadow-sm"
                >
                  <RefreshCw className="w-3 h-3" />
                  Refresh
                </Button>
              )}
              {toolbarExtras}
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
    </SchemaDiagramContext.Provider>
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

export function buildSchemaSql(
  tables: TableData[],
  selectedSchema: string,
  dbType: ConnectionDbType,
) {
  const ordered = orderTablesForSql(tables, selectedSchema);
  return ordered
    .map((table) => buildTableSql(table, selectedSchema, dbType))
    .join("\n\n");
}

/** Create referenced tables before dependents so inline REFERENCES stay valid. */
function orderTablesForSql(tables: TableData[], selectedSchema: string) {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: TableData[] = [];

  const visit = (name: string) => {
    if (visited.has(name) || !byName.has(name)) return;
    if (visiting.has(name)) return; // cycle — keep going without looping
    visiting.add(name);
    const table = byName.get(name)!;
    for (const col of table.columns) {
      const ref = col.references;
      if (!ref) continue;
      if (ref.schema.toLowerCase() !== selectedSchema.toLowerCase()) continue;
      visit(ref.table);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(table);
  };

  for (const table of tables) visit(table.name);
  return ordered;
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
  onEditTable?: (tableName: string) => void,
  onDeleteTable?: (tableName: string) => void,
  editable?: boolean,
  allowConnect?: boolean,
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
      onEditTable,
      onDeleteTable,
      editable,
      allowConnect,
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
  onEditTable?: (tableName: string) => void,
  onDeleteTable?: (tableName: string) => void,
  editable?: boolean,
  allowConnect?: boolean,
): TableData {
  return {
    ...table,
    dbType,
    editable: Boolean(editable),
    allowConnect: Boolean(allowConnect),
    onCopyName: makeCopyNameHandler(),
    onCopySql: makeCopySqlHandler(tables, selectedSchema, dbType),
    onOpenTable: (name: string) => {
      onOpenTable?.(name);
    },
    onFocusTable: (name: string) => {
      onFocusTable?.(name);
    },
    onEditTable: (name: string) => {
      onEditTable?.(name);
    },
    onDeleteTable: (name: string) => {
      onDeleteTable?.(name);
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
  onEditTable,
  onDeleteTable,
  editable,
  allowConnect,
  selectedSchema,
  tables,
  widthById,
}: {
  dbType: ConnectionDbType;
  heightById: Map<string, number>;
  layoutWidth: number;
  onOpenTable?: (tableName: string) => void;
  onFocusTable?: (tableName: string) => void;
  onEditTable?: (tableName: string) => void;
  onDeleteTable?: (tableName: string) => void;
  editable?: boolean;
  allowConnect?: boolean;
  selectedSchema: string;
  tables: TableData[];
  widthById: Map<string, number>;
}) {
  const prebuiltNodes = makeLayoutNodes(
    tables,
    dbType,
    selectedSchema,
    onOpenTable,
    onFocusTable,
    onEditTable,
    onDeleteTable,
    editable,
    allowConnect,
  );
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
  onEditTable,
  onDeleteTable,
  editable,
  allowConnect,
  selectedSchema,
  tables,
  widthById,
}: {
  dbType: ConnectionDbType;
  heightById: Map<string, number>;
  onOpenTable?: (tableName: string) => void;
  onFocusTable?: (tableName: string) => void;
  onEditTable?: (tableName: string) => void;
  onDeleteTable?: (tableName: string) => void;
  editable?: boolean;
  allowConnect?: boolean;
  selectedSchema: string;
  tables: TableData[];
  widthById: Map<string, number>;
}) {
  const nodes: Node<TableData>[] = makeLayoutNodes(
    tables,
    dbType,
    selectedSchema,
    onOpenTable,
    onFocusTable,
    onEditTable,
    onDeleteTable,
    editable,
    allowConnect,
  );

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
  const rowCount = Array.isArray(table.columns) ? table.columns.length : 0;
  return TABLE_NODE_HEADER_HEIGHT + rowCount * TABLE_NODE_ROW_HEIGHT + 1;
}

function quoteTableRef(
  schema: string,
  table: string,
  dbType: ConnectionDbType,
) {
  // SQLite has no real schemas in everyday DDL — "main"."users" is awkward
  // and often rejected by tooling. Emit bare table names instead.
  if (dbType === "sqlite") return quoteIdentifier(table, dbType);
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
