"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Database, Hash, Sparkles } from "@/lib/icon-theme/lucide-react";

import { SqlQueryFind } from "@/components/studio/sql-query-find";
import { highlightSqlWithMatches } from "@/lib/ai/sql-highlight";
import {
  getSqlSuggestions,
  type SqlSuggestionItem,
} from "@/lib/studio/sql-suggestions";
import { buildShortcutCombo } from "@/lib/studio/keybindings";
import type { BaseSqlInputProps } from "@/lib/studio/sql-input-types";

type SqlQueryInputProps = BaseSqlInputProps;

export function SqlQueryInput({
  dbType = "postgres",
  query,
  aiMode = false,
  placeholder,
  fontSize,
  fontFamily,
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
  slashAiTrigger = true,
  aiModeKeybinding = null,
}: SqlQueryInputProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const suggestionRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLPreElement | null>(null);
  const lineCount = useMemo(
    () => Math.max(query.split("\n").length, 1),
    [query],
  );
  const [searchValue, setSearchValue] = useState("");
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<SqlSuggestionItem[]>([]);
  const [suggestionRange, setSuggestionRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [suggestionPosition, setSuggestionPosition] = useState({
    left: 12,
    top: 12,
  });
  const suggestionNeedle = useMemo(() => {
    if (!suggestionRange) return "";
    return query
      .slice(suggestionRange.start, suggestionRange.end)
      .toLowerCase();
  }, [query, suggestionRange]);
  const matches = useMemo(() => {
    if (!searchValue) return [];
    const escaped = searchValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return Array.from(query.matchAll(new RegExp(escaped, "gi"))).map(
      (match) => ({
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
      }),
    );
  }, [query, searchValue]);
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (suggestionRef.current?.contains(target)) return;
      if (textareaRef.current?.contains(target)) return;
      setSuggestions([]);
      setSuggestionRange(null);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const syncSelection = () => {
      const { selectionStart, selectionEnd, value } = textarea;
      onSelectionChange(
        selectionStart === selectionEnd
          ? ""
          : value.slice(selectionStart, selectionEnd),
      );
    };

    syncSelection();
  }, [query, onSelectionChange]);

  const handleSelect = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    onSelectionChange(
      selectionStart === selectionEnd
        ? ""
        : value.slice(selectionStart, selectionEnd),
    );
  };

  const handleScroll = () => {
    if (!textareaRef.current || !gutterRef.current || !overlayRef.current)
      return;
    gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    overlayRef.current.scrollTop = textareaRef.current.scrollTop;
    overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
  };

  const scrollToMatch = (start: number) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const before = query.slice(0, start);
    const lines = before.split("\n");
    const lineIndex = Math.max(lines.length - 1, 0);
    const column = lines[lines.length - 1]?.length ?? 0;
    const lineHeight = 21;
    const charWidth = Math.max(fontSize * 0.6, 7);
    const targetTop = Math.max(
      lineIndex * lineHeight - textarea.clientHeight / 2 + lineHeight,
      0,
    );
    const targetLeft = Math.max(
      column * charWidth - textarea.clientWidth / 3,
      0,
    );
    textarea.scrollTo({ top: targetTop, left: targetLeft, behavior: "smooth" });
  };

  const applyMatch = useCallback(
    (index: number, shouldFocusEditor = false) => {
      const textarea = textareaRef.current;
      const match = matches[index];
      if (!textarea || !match) return;
      if (shouldFocusEditor) {
        textarea.focus();
      }
      textarea.setSelectionRange(match.start, match.end);
      scrollToMatch(match.start);
      setActiveMatchIndex(index);
    },
    [matches, query, fontSize],
  );

  useEffect(() => {
    if (!isFindOpen || matches.length === 0) return;
    applyMatch(0, false);
  }, [applyMatch, isFindOpen, matches.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    const surface = surfaceRef.current;
    if (!textarea || !surface || !suggestionRange) {
      setSuggestionPosition({ left: 12, top: 12 });
      return;
    }

    const before = query.slice(0, textarea.selectionStart);
    const lines = before.split("\n");
    const lineIndex = Math.max(lines.length - 1, 0);
    const column = lines[lines.length - 1]?.length ?? 0;
    const charWidth = Math.max(fontSize * 0.6, 7);
    const popupWidth = 260;
    const paddingLeft = 16;
    const paddingTop = 16;
    const rawLeft = paddingLeft + column * charWidth - textarea.scrollLeft;
    const rawTop = paddingTop + (lineIndex + 1) * 21 - textarea.scrollTop + 6;
    const maxLeft = Math.max(surface.clientWidth - popupWidth - 12, 12);
    const maxTop = Math.max(surface.clientHeight - 220, 12);

    setSuggestionPosition({
      left: Math.min(Math.max(rawLeft, 12), maxLeft),
      top: Math.min(Math.max(rawTop, 12), maxTop),
    });
  }, [fontSize, query, suggestionRange]);

  const refreshSuggestions = () => {
    if (aiMode || isFindOpen) {
      setSuggestions([]);
      setSuggestionRange(null);
      setActiveSuggestionIndex(0);
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) return;
    const activeLabel = suggestions[activeSuggestionIndex]?.label ?? null;
    const result = getSqlSuggestions(
      query,
      textarea.selectionStart,
      schemaData,
      dbType,
    );
    if (!result || result.items.length === 0) {
      setSuggestions([]);
      setSuggestionRange(null);
      setActiveSuggestionIndex(0);
      return;
    }

    setSuggestions(result.items);
    setSuggestionRange({ start: result.tokenStart, end: result.tokenEnd });
    const isClauseBoundaryRefresh = result.tokenStart === result.tokenEnd;
    if (isClauseBoundaryRefresh) {
      setActiveSuggestionIndex(0);
      return;
    }
    const nextIndex = activeLabel
      ? result.items.findIndex((item) => item.label === activeLabel)
      : -1;
    setActiveSuggestionIndex(nextIndex >= 0 ? nextIndex : 0);
  };

  const applySuggestion = (item: SqlSuggestionItem) => {
    const textarea = textareaRef.current;
    if (!textarea || !suggestionRange) return;
    const nextValue = `${query.slice(0, suggestionRange.start)}${item.insertText}${query.slice(suggestionRange.end)}`;
    const cursor = suggestionRange.start + item.insertText.length;
    textarea.value = nextValue;
    textarea.setSelectionRange(cursor, cursor);
    onChange(nextValue);
    setSuggestions([]);
    setSuggestionRange(null);
    textarea.focus();
  };

  const renderSuggestionLabel = (label: string) => {
    if (!suggestionNeedle) return label;
    const lower = label.toLowerCase();
    const index = lower.indexOf(suggestionNeedle);
    if (index === -1) return label;

    return (
      <>
        {label.slice(0, index)}
        <span className="text-sky-400">
          {label.slice(index, index + suggestionNeedle.length)}
        </span>
        {label.slice(index + suggestionNeedle.length)}
      </>
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      slashAiTrigger &&
      aiModeKeybinding &&
      !aiMode &&
      !query.trim() &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const combo = buildShortcutCombo(event);
      if (combo === aiModeKeybinding) {
        event.preventDefault();
        onRequestAiMode?.();
        return;
      }
    }

    if (aiMode && !query.trim() && event.key === "Escape") {
      event.preventDefault();
      onExitAiMode?.();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setIsFindOpen(true);
      return;
    }

    if (!aiMode && suggestions.length > 0 && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((current) =>
        Math.min(current + 1, suggestions.length - 1),
      );
      return;
    }

    if (!aiMode && suggestions.length > 0 && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (!aiMode && suggestions.length > 0 && event.key === "Tab") {
      event.preventDefault();
      applySuggestion(suggestions[activeSuggestionIndex]);
      return;
    }

    if (!aiMode && suggestions.length > 0 && event.key === "Escape") {
      setSuggestions([]);
      setSuggestionRange(null);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        onRunSelected();
        return;
      }

      const textarea = textareaRef.current;
      if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
        onRunSelected();
        return;
      }

      onRun();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSaveSnippet();
      return;
    }

    if (
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "c"
    ) {
      event.preventDefault();
      onCopyQuery?.();
      return;
    }

    if (event.shiftKey && event.altKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      onFormat?.();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const { selectionStart, selectionEnd, value } = textarea;
      const nextValue = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      onChange(nextValue);
      requestAnimationFrame(() => {
        textarea.selectionStart = selectionStart + 2;
        textarea.selectionEnd = selectionStart + 2;
        handleSelect();
        refreshSuggestions();
      });
    }
  };

  return (
    <div className="relative flex h-full min-h-0 bg-studio-bg">
      {isFindOpen && (
        <SqlQueryFind
          matchCount={matches.length}
          onChange={(value) => {
            setSearchValue(value);
            setActiveMatchIndex(0);
          }}
          onClose={() => {
            setIsFindOpen(false);
            setSearchValue("");
          }}
          onNext={() => {
            if (!matches.length) return;
            applyMatch((activeMatchIndex + 1) % matches.length, false);
          }}
          onPrevious={() => {
            if (!matches.length) return;
            applyMatch(
              (activeMatchIndex - 1 + matches.length) % matches.length,
              false,
            );
          }}
          searchValue={searchValue}
          selectedIndex={activeMatchIndex}
        />
      )}

      <div
        ref={gutterRef}
        aria-hidden="true"
        className="w-9 shrink-0 overflow-hidden border-r border-studio-border bg-studio-bg px-1 py-4 text-center font-mono text-muted-foreground/70 select-none"
        style={{ fontSize, lineHeight: "21px", fontFamily }}
      >
        {Array.from({ length: lineCount }).map((_, index) => (
          <div key={index + 1}>{index + 1}</div>
        ))}
      </div>

      <div ref={surfaceRef} className="relative flex-1">
        <pre
          ref={overlayRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-0 overflow-auto px-4 py-4 font-mono whitespace-pre"
          style={{
            fontSize,
            lineHeight: "21px",
            tabSize: 2,
            minWidth: "100%",
            fontFamily,
          }}
        >
          <code className="inline-block min-w-full">
            {highlightSqlWithMatches(
              query || " ",
              isFindOpen ? matches : [],
              isFindOpen ? activeMatchIndex : -1,
            )}
          </code>
        </pre>

        <textarea
          ref={textareaRef}
          className="relative z-10 h-full w-full min-w-full resize-none border-0 bg-transparent px-4 py-4 font-mono text-transparent caret-foreground outline-none placeholder:text-muted-foreground/40"
          cols={1}
          onChange={(event) => {
            onChange(event.target.value);
            requestAnimationFrame(refreshSuggestions);
          }}
          onClick={refreshSuggestions}
          onKeyDown={handleKeyDown}
          onKeyUp={refreshSuggestions}
          onScroll={handleScroll}
          onSelect={() => {
            handleSelect();
            refreshSuggestions();
          }}
          onBlur={() => {
            window.setTimeout(() => {
              const active = document.activeElement;
              if (
                active instanceof Node &&
                (textareaRef.current?.contains(active) ||
                  suggestionRef.current?.contains(active))
              ) {
                return;
              }

              setSuggestions([]);
              setSuggestionRange(null);
            }, 0);
          }}
          spellCheck={false}
          style={{ fontSize, lineHeight: "21px", tabSize: 2, fontFamily }}
          wrap="off"
          value={query}
        />
        {!query.trim() && placeholder ? (
          <div
            className="pointer-events-none absolute inset-0 z-20 px-4 py-4 font-mono text-muted-foreground/45 whitespace-pre-wrap"
            style={{ fontSize, lineHeight: "21px", tabSize: 2, fontFamily }}
          >
            {placeholder}
          </div>
        ) : null}

        {!aiMode && suggestions.length > 0 && (
          <div
            ref={suggestionRef}
            className="absolute z-20 max-h-48 w-[360px] overflow-y-auto border border-studio-border bg-[#1e1e1e] py-0.5 shadow-lg"
            style={{
              left: suggestionPosition.left,
              top: suggestionPosition.top,
            }}
          >
            {suggestions.map((item, index) => {
              const Icon =
                item.kind === "table"
                  ? Database
                  : item.kind === "column"
                    ? Hash
                    : Sparkles;
              return (
                <button
                  key={`${item.kind}-${item.label}`}
                  className={`flex w-full items-start gap-2 px-2 py-1 text-left font-mono ${
                    index === activeSuggestionIndex
                      ? "bg-[#2a2d2e] text-[#d4d4d4]"
                      : "text-[#d4d4d4] hover:bg-[#252526]"
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applySuggestion(item);
                  }}
                  type="button"
                >
                  <Icon
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                      item.kind === "keyword" || item.kind === "function"
                        ? "text-[#c586c0]"
                        : item.kind === "table"
                          ? "text-[#4fc1ff]"
                          : "text-[#d7ba7d]"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-xs leading-5">
                      {renderSuggestionLabel(item.label)}
                    </div>
                    {item.detail ? (
                      <div className="truncate text-xs leading-4 text-[#858585]">
                        {item.detail}
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
