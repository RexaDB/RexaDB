// Data dictionary types (Outerbase column-descriptor / data-catalog /
// data-decorator parity). Storage lives in the Rust backend
// (src-tauri/src/dictionary.rs); this module only describes the shapes.

export interface DictionaryScope {
  /** "schema.table" -> description */
  tables: Record<string, string>;
  /** "schema.table.column" -> description */
  columns: Record<string, string>;
  /** "schema.table.column" -> decorator */
  decorators: Record<string, ColumnDecorator>;
  /** key -> updated_at millis (tables + columns) */
  updatedAt: Record<string, number>;
}

export const EMPTY_DICTIONARY_SCOPE: DictionaryScope = {
  tables: {},
  columns: {},
  decorators: {},
  updatedAt: {},
};

/** Fresh empty scope with OWN nested objects. Never spread
 *  EMPTY_DICTIONARY_SCOPE — the spread shares the inner maps, so writing
 *  into a "fresh" scope would pollute every other empty scope (including
 *  other connections). */
export function freshEmptyScope(): DictionaryScope {
  return { tables: {}, columns: {}, decorators: {}, updatedAt: {} };
}

export type ColumnDecorator =
  | {
      kind: "enum-map";
      /** raw value (stringified) -> label */
      mapping: Record<string, string>;
      /** raw value (stringified) -> pill color (CSS color, optional) */
      colors?: Record<string, string>;
    }
  | {
      kind: "mask";
      /** show this many trailing characters; 0 = full mask */
      visibleChars?: number;
      maskChar?: string;
    }
  | {
      kind: "prefix-suffix";
      prefix?: string;
      suffix?: string;
    }
  | {
      kind: "truncate";
      maxLength: number;
    }
  | {
      kind: "date-format";
      /** "relative" | "date" | "datetime" | "time" */
      format: string;
    };

export interface CatalogColumnEntry {
  schema: string;
  table: string;
  column: string;
  dataType: string;
  isNullable: boolean;
  isPrimary: boolean;
  isForeignKey: boolean;
  description: string | null;
  descriptionSource: "local" | "native" | null;
  decorator: ColumnDecorator | null;
}

export interface CatalogTableEntry {
  schema: string;
  table: string;
  description: string | null;
  descriptionSource: "local" | "native" | null;
  columns: CatalogColumnEntry[];
}

export interface NativeCommentMaps {
  tables: Record<string, string>;
  columns: Record<string, string>;
}
