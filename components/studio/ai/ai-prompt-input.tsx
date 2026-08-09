"use client";

import { useEffect, useRef, useState } from "react";
import type { FocusEventHandler, KeyboardEventHandler } from "react";

function renderParts(value: string, validMentions: Set<string>) {
  const parts: Array<{ text: string; mention: boolean }> = [];
  const regex = /[@$][\w./:#-]+/g;
  let lastIndex = 0;

  for (const match of value.matchAll(regex)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: value.slice(lastIndex, index), mention: false });
    }
    parts.push({
      text: match[0],
      mention:
        validMentions.has(match[0].toLowerCase()) ||
        validMentions.has(match[0].slice(1).toLowerCase()),
    });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < value.length) {
    parts.push({ text: value.slice(lastIndex), mention: false });
  }

  return parts.length > 0 ? parts : [{ text: value, mention: false }];
}

export function AiPromptInput({
  disabled,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  placeholder,
  validMentions,
  value,
}: {
  disabled?: boolean;
  onChange: (value: string) => void;
  onFocus?: FocusEventHandler<HTMLTextAreaElement>;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  placeholder: string;
  validMentions: Set<string>;
  value: string;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "42px";
    const nextHeight = Math.min(textareaRef.current.scrollHeight, 176);
    textareaRef.current.style.height = `${Math.max(42, nextHeight)}px`;
  }, [value]);

  return (
    <div className="relative min-h-[42px] max-h-44 overflow-hidden">
      {value ? (
        <div
          aria-hidden="true"
          ref={overlayRef}
          className={`pointer-events-none absolute inset-0 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-xs leading-5 text-foreground ${isSelecting ? "opacity-0" : ""}`}
        >
          {renderParts(value, validMentions).map((part, index) => (
            <span
              key={`${part.text}-${index}`}
              className={
                part.mention
                  ? "rounded-lg bg-primary/15 text-primary"
                  : undefined
              }
            >
              {part.text}
            </span>
          ))}
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        className={`relative z-10 min-h-[42px] max-h-44 w-full resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 pr-1 text-xs leading-5 shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:bg-transparent ${isSelecting ? "text-foreground" : "text-transparent"} caret-foreground`}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => {
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setIsSelecting(false);
          onBlur?.(event);
        }}
        onKeyDown={onKeyDown}
        onSelect={(event) => {
          setIsSelecting(
            event.currentTarget.selectionStart !==
              event.currentTarget.selectionEnd,
          );
        }}
        onScroll={(event) => {
          if (overlayRef.current) {
            overlayRef.current.scrollTop = event.currentTarget.scrollTop;
            overlayRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}
