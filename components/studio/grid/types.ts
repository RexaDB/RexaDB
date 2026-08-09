export interface EditColumnForeignKey {
  schema: string;
  table: string;
  column: string;
  onUpdate?: string;
  onDelete?: string;
}

export interface AddColumnPayload {
  name: string;
  type: string;
  isNullable: boolean;
  default: string;
  isPrimary?: boolean;
  isUnique?: boolean;
  isArray?: boolean;
  checkConstraint?: string;
  createMore?: boolean;
  foreignKey?: EditColumnForeignKey;
}

export interface EditColumnPayload {
  columnName: string;
  newName: string;
  dataType: string;
  isNullable: boolean;
  isPrimary: boolean;
  isUnique: boolean;
  uniqueTouched: boolean;
  defaultValue: string;
  checkConstraint: string;
  checkTouched: boolean;
  foreignKeyEnabled: boolean;
  foreignKey?: EditColumnForeignKey;
}

export interface FKPreviewData {
  rowIndex: number;
  columnName: string;
  schema: string;
  table: string;
  data: any;
  fields: any[];
  loading?: boolean;
}

export type ToggleFKPreviewFn = (
  rowIndex: number,
  columnName: string,
  value: any,
  event?: React.MouseEvent,
) => void;
