"use client";

import {
  Tag,
  Download,
  Eraser,
  Trash2,
  Check,
  Copy,
  Files,
} from "@/lib/icon-theme/lucide-react";

interface TagItem {
  name: string;
  color: string;
}

interface TableTagsSubmenuProps {
  Component: React.ComponentType<any>;
  Sub: React.ComponentType<any>;
  SubTrigger: React.ComponentType<any>;
  SubContent: React.ComponentType<any>;
  tags: TagItem[];
  table: string;
  selectedSchema: string;
  tableTags: Record<string, string[]>;
  onToggleTag: (schema: string, table: string, tagName: string) => void;
  handleAction: (fn: (...args: any[]) => void) => (e: React.MouseEvent) => void;
}

function TableTagsSubmenu({
  Component,
  Sub,
  SubTrigger,
  SubContent,
  tags,
  table,
  selectedSchema,
  tableTags,
  onToggleTag,
  handleAction,
}: TableTagsSubmenuProps) {
  return (
    <Sub>
      <SubTrigger className="text-xs">
        <Tag className="mr-2 h-3.5 w-3.5" />
        Tags
      </SubTrigger>
      <SubContent className="w-48 bg-popover border-border shadow-2xl">
        {tags.length === 0 ? (
          <Component className="text-xs disabled opacity-50">
            No tags defined
          </Component>
        ) : (
          tags.map((tag) => (
            <Component
              key={tag.name}
              className="text-xs flex items-center justify-between"
              onClick={handleAction(() =>
                onToggleTag(selectedSchema, table, tag.name),
              )}
            >
              <div className="flex items-center">
                <div
                  className="w-2 h-2 rounded-lg mr-2"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </div>
              {(tableTags[`${selectedSchema}.${table}`] || []).includes(
                tag.name,
              ) && <Check className="h-3.5 w-3.5 text-emerald-500" />}
            </Component>
          ))
        )}
      </SubContent>
    </Sub>
  );
}

interface TableExportSubmenuProps {
  Component: React.ComponentType<any>;
  Sub: React.ComponentType<any>;
  SubTrigger: React.ComponentType<any>;
  SubContent: React.ComponentType<any>;
  canExportSql: boolean;
  onExport: (format: "csv" | "json" | "sql") => void;
  isDropdown?: boolean;
}

function TableExportSubmenu({
  Component,
  Sub,
  SubTrigger,
  SubContent,
  canExportSql,
  onExport,
  isDropdown,
}: TableExportSubmenuProps) {
  const handleClick =
    (format: "csv" | "json" | "sql") => (e: React.MouseEvent) => {
      if (isDropdown) e.stopPropagation();
      onExport(format);
    };

  return (
    <Sub>
      <SubTrigger className="text-xs">
        <Download className="mr-2 h-3.5 w-3.5" />
        Export Data
      </SubTrigger>
      <SubContent className="bg-popover border-border shadow-2xl">
        <Component className="text-xs" onClick={handleClick("csv")}>
          CSV
        </Component>
        <Component className="text-xs" onClick={handleClick("json")}>
          JSON
        </Component>
        {canExportSql && (
          <Component className="text-xs" onClick={handleClick("sql")}>
            SQL
          </Component>
        )}
      </SubContent>
    </Sub>
  );
}

interface ConfirmDialogConfig {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  variant: "destructive";
}

interface TableActionProps {
  table: string;
  selectedSchema: string;
  isMongo: boolean;
  isDropdown?: boolean;
  setConfirmDialog: (dialog: ConfirmDialogConfig) => void;
  onEmpty: (table: string, schema: string) => void;
  onDelete: (table: string, schema: string) => void;
}

interface EmptyDeleteItemsProps extends TableActionProps {
  Component: React.ComponentType<any>;
}

function TableEmptyDeleteItems({
  Component,
  table,
  selectedSchema,
  isMongo,
  isDropdown,
  setConfirmDialog,
  onEmpty,
  onDelete,
}: EmptyDeleteItemsProps) {
  const handleEmpty = (e: React.MouseEvent) => {
    if (isDropdown) e.stopPropagation();
    setConfirmDialog({
      open: true,
      title: isMongo
        ? `Empty collection "${table}"?`
        : `Empty table "${table}"?`,
      description: isMongo
        ? "This will delete all documents in the collection. This action cannot be undone."
        : "This will delete all data in the table. This action cannot be undone.",
      onConfirm: () => onEmpty(table, selectedSchema),
      variant: "destructive",
    });
  };

  const handleDelete = (e: React.MouseEvent) => {
    if (isDropdown) e.stopPropagation();
    setConfirmDialog({
      open: true,
      title: isMongo
        ? `Delete collection "${table}"?`
        : `Delete table "${table}"?`,
      description: isMongo
        ? "Are you sure you want to delete this collection? This action cannot be undone."
        : "Are you sure you want to delete this table? This action cannot be undone.",
      onConfirm: () => onDelete(table, selectedSchema),
      variant: "destructive",
    });
  };

  return (
    <>
      <Component
        className="text-xs text-amber-500 focus:text-amber-500 focus:bg-amber-500/10"
        onClick={handleEmpty}
      >
        <Eraser className="mr-2 h-3.5 w-3.5" />
        {isMongo ? "Empty Collection" : "Truncate Table"}
      </Component>
      <Component
        className="text-xs text-red-500 focus:text-red-500 focus:bg-red-500/10"
        onClick={handleDelete}
      >
        <Trash2 className="mr-2 h-3.5 w-3.5" />
        {isMongo ? "Delete Collection" : "Delete Table"}
      </Component>
    </>
  );
}

interface TableMenuExportDeleteProps extends TableActionProps {
  Component: React.ComponentType<any>;
  Sub: React.ComponentType<any>;
  SubTrigger: React.ComponentType<any>;
  SubContent: React.ComponentType<any>;
  Separator: React.ComponentType<any>;
  canExportSql: boolean;
  onExport: (format: "csv" | "json" | "sql") => void;
  beforeExport?: React.ReactNode;
}

function TableMenuExportDeleteItems(props: TableMenuExportDeleteProps) {
  const {
    Component,
    Sub,
    SubTrigger,
    SubContent,
    Separator,
    canExportSql,
    onExport,
    isDropdown,
    table,
    selectedSchema,
    isMongo,
    setConfirmDialog,
    onEmpty,
    onDelete,
    beforeExport,
  } = props;
  return (
    <>
      {beforeExport}
      <TableExportSubmenu
        Component={Component}
        Sub={Sub}
        SubTrigger={SubTrigger}
        SubContent={SubContent}
        canExportSql={canExportSql}
        onExport={onExport}
        isDropdown={isDropdown}
      />
      <Separator />
      <TableEmptyDeleteItems
        Component={Component}
        table={table}
        selectedSchema={selectedSchema}
        isMongo={isMongo}
        isDropdown={isDropdown}
        setConfirmDialog={setConfirmDialog}
        onEmpty={onEmpty}
        onDelete={onDelete}
      />
    </>
  );
}

interface TableContextMenuItemsProps extends TableActionProps {
  Component: React.ComponentType<any>;
  Sub: React.ComponentType<any>;
  SubTrigger: React.ComponentType<any>;
  SubContent: React.ComponentType<any>;
  Separator: React.ComponentType<any>;
  itemNoun: string;
  copyDefinitionLabel: string;
  duplicateLabel: string;
  canExportSql: boolean;
  tags: TagItem[];
  tableTags: Record<string, string[]>;
  handleAction: (fn: (...args: any[]) => void) => (e: React.MouseEvent) => void;
  onToggleTag: (schema: string, table: string, tagName: string) => void;
  handleCopyName: (...args: any[]) => void;
  handleCopyDefinition: (...args: any[]) => void;
  handleDuplicate: (...args: any[]) => void;
  onExport: (format: "csv" | "json" | "sql") => void;
  beforeExport?: React.ReactNode;
}

export function TableContextMenuItems(props: TableContextMenuItemsProps) {
  const {
    Component,
    Sub,
    SubTrigger,
    SubContent,
    Separator,
    itemNoun,
    copyDefinitionLabel,
    duplicateLabel,
    isMongo,
    canExportSql,
    isDropdown,
    table,
    selectedSchema,
    tags,
    tableTags,
    handleAction,
    onToggleTag,
    handleCopyName,
    handleCopyDefinition,
    handleDuplicate,
    onExport,
    setConfirmDialog,
    onEmpty,
    onDelete,
    beforeExport,
  } = props;
  return (
    <>
      <Component className="text-xs" onClick={handleAction(handleCopyName)}>
        <Copy className="mr-2 h-3.5 w-3.5" />
        Copy {itemNoun} Name
      </Component>
      <Separator />
      <TableTagsSubmenu
        Component={Component}
        Sub={Sub}
        SubTrigger={SubTrigger}
        SubContent={SubContent}
        tags={tags}
        table={table}
        selectedSchema={selectedSchema}
        tableTags={tableTags}
        onToggleTag={onToggleTag}
        handleAction={handleAction}
      />
      <Separator />
      <Component
        className="text-xs"
        onClick={handleAction(handleCopyDefinition)}
      >
        <Copy className="mr-2 h-3.5 w-3.5" />
        {copyDefinitionLabel}
      </Component>
      <Component className="text-xs" onClick={handleAction(handleDuplicate)}>
        <Files className="mr-2 h-3.5 w-3.5" />
        {duplicateLabel}
      </Component>
      <TableMenuExportDeleteItems
        Component={Component}
        Sub={Sub}
        SubTrigger={SubTrigger}
        SubContent={SubContent}
        Separator={Separator}
        canExportSql={canExportSql}
        onExport={onExport}
        isDropdown={isDropdown}
        table={table}
        selectedSchema={selectedSchema}
        isMongo={isMongo}
        setConfirmDialog={setConfirmDialog}
        onEmpty={onEmpty}
        onDelete={onDelete}
        beforeExport={beforeExport}
      />
    </>
  );
}
