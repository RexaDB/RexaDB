export type SchemaData = Record<
  string,
  {
    schema?: string;
    name?: string;
    columns?: Array<{ name?: string; type?: string }>;
  }
>;

export interface BaseSqlInputProps {
  dbType?: string;
  query: string;
  aiMode?: boolean;
  placeholder?: string;
  fontSize: number;
  fontFamily?: string;
  schemaData: SchemaData;
  onChange: (value: string) => void;
  onRequestAiMode?: () => void;
  onExitAiMode?: () => void;
  onRun: () => void;
  onRunSelected: () => void;
  onSaveSnippet: () => void;
  onSelectionChange: (selectedText: string) => void;
  onCopyQuery?: () => void;
  onFormat?: () => void;
  slashAiTrigger?: boolean;
  aiModeKeybinding?: string | null;
}
