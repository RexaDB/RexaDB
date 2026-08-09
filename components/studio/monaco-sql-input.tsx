"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import {
  registerCustomMonacoThemes,
  getStudioDarkTheme,
  type MonacoThemeRef,
  type CustomEditorTheme,
} from "@/lib/studio/editor-themes";
import { getSqlSuggestions } from "@/lib/studio/sql-suggestions";
import { buildShortcutCombo } from "@/lib/studio/keybindings";
import type { BaseSqlInputProps } from "@/lib/studio/sql-input-types";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-studio-bg">
      <div className="text-muted-foreground/40 text-sm">Loading editor...</div>
    </div>
  ),
});

interface MonacoSqlInputProps extends BaseSqlInputProps {
  dbType: string;
  themeId: string;
  readOnly?: boolean;
  customEditorThemes?: CustomEditorTheme[];
  appEditorTheme?: MonacoThemeRef | null;
  layoutVersion?: number;
  vimMode?: boolean;
}

export function MonacoSqlInput({
  dbType,
  query,
  aiMode = false,
  placeholder,
  fontSize,
  fontFamily,
  themeId,
  readOnly = false,
  customEditorThemes = [],
  appEditorTheme = null,
  layoutVersion = 0,
  schemaData,
  onChange,
  onRequestAiMode,
  onExitAiMode,
  onRun,
  onRunSelected,
  onSaveSnippet,
  onCopyQuery,
  onFormat,
  onSelectionChange,
  vimMode = false,
  slashAiTrigger = true,
  aiModeKeybinding = null,
}: MonacoSqlInputProps) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const completionProviderRef = useRef<{ dispose: () => void } | null>(null);
  const vimDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const vimStatusRef = useRef<HTMLDivElement | null>(null);
  const statusBarRef = useRef<HTMLDivElement | null>(null);
  const aiModeRef = useRef(aiMode);
  const slashAiTriggerRef = useRef(slashAiTrigger);
  const [isDragging, setIsDragging] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [selectionSize, setSelectionSize] = useState<number | null>(null);
  const queryRef = useRef(query);
  const onRunRef = useRef(onRun);
  const onRunSelectedRef = useRef(onRunSelected);
  const onCopyQueryRef = useRef(onCopyQuery);
  const onFormatRef = useRef(onFormat);
  const onRequestAiModeRef = useRef(onRequestAiMode);
  const lastPasteRef = useRef<{
    ts: number;
    source: "keydown" | "paste" | "";
    text: string;
  }>({
    ts: 0,
    source: "",
    text: "",
  });
  const customMonacoThemes = useMemo(
    () =>
      appEditorTheme
        ? [...customEditorThemes, appEditorTheme as any]
        : customEditorThemes,
    [appEditorTheme, customEditorThemes],
  );

  useEffect(() => {
    aiModeRef.current = aiMode;
    slashAiTriggerRef.current = slashAiTrigger;
    queryRef.current = query;
    onRunRef.current = onRun;
    onRunSelectedRef.current = onRunSelected;
    onCopyQueryRef.current = onCopyQuery;
    onFormatRef.current = onFormat;
    onRequestAiModeRef.current = onRequestAiMode;
  }, [
    aiMode,
    slashAiTrigger,
    onCopyQuery,
    onFormat,
    onRequestAiMode,
    onRun,
    onRunSelected,
    query,
  ]);

  // Track drag state via mouse events on window
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleDragStart = () => {
      setIsDragging(true);
    };
    const handleDragEnd = () => {
      setIsDragging(false);
    };
    const handleMouseDown = () => {
      // Small delay to detect if this leads to a drag
      setTimeout(() => setIsDragging(false), 50);
    };
    window.addEventListener("dragstart", handleDragStart);
    window.addEventListener("dragend", handleDragEnd);
    window.addEventListener("mousedown", handleMouseDown);
    return () => {
      window.removeEventListener("dragstart", handleDragStart);
      window.removeEventListener("dragend", handleDragEnd);
      window.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  const shouldEnterAiMode = () =>
    slashAiTriggerRef.current &&
    aiModeKeybinding != null &&
    !aiModeRef.current &&
    !queryRef.current.trim();

  const registerCompletionProvider = () => {
    const monaco = monacoRef.current;
    completionProviderRef.current?.dispose();
    if (!monaco || dbType === "mongodb" || dbType === "redis" || aiMode) return;
    completionProviderRef.current =
      monaco.languages.registerCompletionItemProvider("sql", {
        triggerCharacters: [".", " "],
        provideCompletionItems: (model: any, position: any) => {
          const offset = model.getOffsetAt(position);
          const result = getSqlSuggestions(
            model.getValue(),
            offset,
            schemaData,
            dbType,
          );
          if (!result) return { suggestions: [] };
          return {
            suggestions: result.items.map((item, index) => {
              const start = model.getPositionAt(result.tokenStart);
              const end = model.getPositionAt(result.tokenEnd);
              return {
                label: item.label,
                insertText: item.insertText,
                detail: item.detail,
                sortText: index.toString().padStart(4, "0"),
                kind:
                  item.kind === "table"
                    ? monaco.languages.CompletionItemKind.Class
                    : item.kind === "column"
                      ? monaco.languages.CompletionItemKind.Field
                      : item.kind === "function"
                        ? monaco.languages.CompletionItemKind.Function
                        : monaco.languages.CompletionItemKind.Keyword,
                range: {
                  startLineNumber: start.lineNumber,
                  startColumn: start.column,
                  endLineNumber: end.lineNumber,
                  endColumn: end.column,
                },
              };
            }),
          };
        },
      });
  };

  useEffect(() => {
    if (!monacoRef.current) return;
    if (!editorRef.current) return;
    if (editorRef.current.isDisposed?.()) return;
    if (!editorRef.current.getDomNode()) return;
    try {
      registerCustomMonacoThemes(monacoRef.current, customMonacoThemes as any);
      monacoRef.current.editor.setTheme(themeId);
      registerCompletionProvider();
    } catch {
      // Editor disposed or other error
    }
  }, [aiMode, customMonacoThemes, dbType, schemaData, themeId]);

  useEffect(() => {
    if (!editorRef.current || editorRef.current.isDisposed?.()) return;
    try {
      const model = editorRef.current.getModel?.();
      if (model && model.getValue() !== query) {
        editorRef.current.setValue(query);
      }
    } catch {
      // Editor disposed
    }
  }, [query]);

// fallow-ignore-next-line code-duplication
  useEffect(() => {
    if (!editorRef.current || editorRef.current.isDisposed?.()) return;
    const handle = window.requestAnimationFrame(() =>
      editorRef.current?.layout?.(),
    );
    return () => window.cancelAnimationFrame(handle);
  }, [layoutVersion]);

  useEffect(() => {
    return () => {
      completionProviderRef.current?.dispose();
      completionProviderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current || editorRef.current.isDisposed?.()) return;
    if (vimMode) {
      if (vimDisposableRef.current) return;
      void import("monaco-vim").then(({ initVimMode: initVim }) => {
        if (
          editorRef.current &&
          vimStatusRef.current &&
          !vimDisposableRef.current
        ) {
          vimDisposableRef.current = initVim(
            editorRef.current,
            vimStatusRef.current,
          );
        }
      });
    } else {
      vimDisposableRef.current?.dispose();
      vimDisposableRef.current = null;
    }
    return () => {
      vimDisposableRef.current?.dispose();
      vimDisposableRef.current = null;
    };
  }, [vimMode]);

  return (
    <div className="h-full flex flex-col">
      <div className="relative flex-1 min-h-0">
        <MonacoEditor
          height="100%"
          language={
            dbType === "mongodb"
              ? "javascript"
              : dbType === "redis"
                ? "plaintext"
                : "sql"
          }
          options={{
            minimap: { enabled: false },
            fontSize,
            fontFamily,
            wordWrap: "off",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 16, bottom: 16 },
            lineNumbersMinChars: 2,
            glyphMargin: false,
            folding: false,
            roundedSelection: false,
            overviewRulerBorder: false,
            readOnly,
          }}
          theme={themeId}
          value={query}
          beforeMount={(monaco: any) => {
            monacoRef.current = monaco;
            monaco.editor.defineTheme("studio-dark", getStudioDarkTheme());
            registerCustomMonacoThemes(monaco, customMonacoThemes as any);
            registerCompletionProvider();
          }}
          onChange={(value) => onChange(value ?? "")}
          onMount={(editor: any, monaco: any) => {
            editorRef.current = editor;
            monacoRef.current = monaco;

            if (vimMode && vimStatusRef.current && !vimDisposableRef.current) {
              void import("monaco-vim").then(({ initVimMode: initVim }) => {
                if (!vimDisposableRef.current && vimStatusRef.current) {
                  vimDisposableRef.current = initVim(
                    editor,
                    vimStatusRef.current,
                  );
                }
              });
            }

            const updateCursor = () => {
              const pos = editor.getPosition();
              if (pos) setCursorPos({ line: pos.lineNumber, col: pos.column });
              const sel = editor.getSelection();
              if (sel && !sel.isEmpty()) {
                const model = editor.getModel();
                if (model) setSelectionSize(model.getValueInRange(sel).length);
                else setSelectionSize(null);
              } else {
                setSelectionSize(null);
              }
            };
            editor.onDidChangeCursorPosition(updateCursor);
            editor.onDidChangeCursorSelection(updateCursor);

            // Cleanup on dispose
            editor.onDidDispose(() => {
              editorRef.current = null;
              monacoRef.current = null;
              vimDisposableRef.current?.dispose();
              vimDisposableRef.current = null;
            });
            const applyClipboardText = (text: string) => {
              if (!text) return false;
              const selections = editor.getSelections?.();
              if (!selections || selections.length === 0) return false;
              editor.executeEdits(
                "sql-editor-clipboard-paste-fallback",
                selections.map((selection: any) => ({
                  range: selection,
                  text,
                  forceMoveMarkers: true,
                })),
              );
              return true;
            };
            const syncSelection = () => {
              const model = editor.getModel?.();
              const selection = editor.getSelection?.();
              if (!model || !selection || selection.isEmpty()) {
                onSelectionChange("");
                return;
              }
              onSelectionChange(model.getValueInRange(selection) || "");
            };
            const handlePasteKeyDown = async (
              editorInstance: any,
              event: any,
              onPaste: () => Promise<void>,
            ) => {
              const key = String(event.browserEvent?.key || "").toLowerCase();
              const isPasteShortcut =
                ((event.browserEvent?.metaKey || event.browserEvent?.ctrlKey) &&
                  key === "v") ||
                (event.browserEvent?.shiftKey &&
                  event.browserEvent?.key === "Insert");
              if (!isPasteShortcut) return;
              if (!editorInstance.hasTextFocus?.()) return;
              try {
                await onPaste();
              } catch (error) {
                console.error("SQL Monaco editor paste failed:", error);
              }
            };
            syncSelection();
            editor.onKeyDown((event: any) => {
              if (!shouldEnterAiMode()) return;
              if (!aiModeKeybinding) return;
              const nativeEvent = event.browserEvent as
                | KeyboardEvent
                | undefined;
              if (
                !nativeEvent ||
                nativeEvent.metaKey ||
                nativeEvent.ctrlKey ||
                nativeEvent.altKey
              )
                return;
              const combo = buildShortcutCombo(nativeEvent);
              if (combo !== aiModeKeybinding) return;
              event.preventDefault();
              event.stopPropagation();
              onRequestAiModeRef.current?.();
            });
            editor.addCommand(monaco.KeyCode.Escape, () => {
              if (!aiModeRef.current || queryRef.current.trim()) return;
              onExitAiMode?.();
            });
            editor.onDidChangeCursorSelection(syncSelection);
            editor.addCommand(
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
              () => {
                const selection = editor.getSelection?.();
                if (selection && !selection.isEmpty()) {
                  onRunSelectedRef.current();
                  return;
                }
                onRunRef.current();
              },
            );
            editor.addCommand(
              monaco.KeyMod.CtrlCmd |
                monaco.KeyMod.Shift |
                monaco.KeyCode.Enter,
              () => onRunSelectedRef.current(),
            );
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
              onSaveSnippet(),
            );
            editor.addCommand(
              monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyC,
              () => onCopyQueryRef.current?.(),
            );
            editor.addCommand(
              monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
              () => onFormatRef.current?.(),
            );
            {
              // Generic clipboard paste fallback
              const domNode = editor.getDomNode?.() as HTMLElement | null;
              const handleDomPaste = (event: ClipboardEvent) => {
                if (!editor.hasTextFocus?.()) return;
                const text = event.clipboardData?.getData("text/plain") || "";
                if (!text) return;
                event.preventDefault();
                applyClipboardText(text);
              };
              domNode?.addEventListener("paste", handleDomPaste, true);
              const editorKeydownDisposable = editor.onKeyDown(
                async (event: any) => {
                  await handlePasteKeyDown(editor, event, async () => {
                    if (!navigator.clipboard?.readText) return;
                    const text = await navigator.clipboard.readText();
                    if (!text) return;
                    event.preventDefault();
                    applyClipboardText(text);
                  });
                },
              );
              editor.onDidDispose(() => {
                domNode?.removeEventListener("paste", handleDomPaste, true);
                editorKeydownDisposable?.dispose?.();
              });
            }
          }}
        />
        {!query.trim() && placeholder ? (
          <div className="pointer-events-none absolute inset-y-0 left-[12px] right-0 z-10 px-4 py-4 font-mono text-sm leading-[21px] text-muted-foreground/45">
            {placeholder}
          </div>
        ) : null}
      </div>
      <div
        ref={statusBarRef}
        className="h-5 text-xs font-mono px-2 flex items-center justify-between text-muted-foreground/60 border-t border-border bg-studio-bg/80 select-none"
      >
        <div ref={vimStatusRef} className="flex items-center gap-1" />
        <div className="flex items-center gap-3">
          {readOnly && (
            <span className="text-amber-500/70 font-semibold">READ-ONLY</span>
          )}
          {selectionSize !== null && (
            <span className="tabular-nums">{selectionSize} chars selected</span>
          )}
          <span className="tabular-nums">
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
          <span className="uppercase text-xs opacity-60">
            {dbType === "mongodb"
              ? "JavaScript"
              : dbType === "redis"
                ? "Plain"
                : "SQL"}
          </span>
        </div>
      </div>
    </div>
  );
}
