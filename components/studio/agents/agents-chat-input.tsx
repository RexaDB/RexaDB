"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { AgentProvider, AgentProviderId } from "@/lib/agents/provider-types";
import type { RexaAgentAppMode } from "@/lib/agents/app-modes";
import { AgentsModelPicker } from "./agents-model-picker";
import { AgentsModePicker } from "./agents-mode-picker";

export function AgentsChatInput({
  onSend,
  isStreaming,
  onStop,
  activeProvider,
  providers,
  onSelectProvider,
  selectedModel,
  onSelectModel,
  selectedMode,
  onSelectMode,
  appModes = [],
  selectedAppModeId,
  onSelectAppMode,
  appMode,
  isDetecting,
}: {
  onSend: (content: string) => void;
  isStreaming: boolean;
  onStop: () => void;
  activeProvider: AgentProviderId;
  providers: AgentProvider[];
  onSelectProvider: (id: AgentProviderId) => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  selectedMode: string;
  onSelectMode: (mode: string) => void;
  appModes?: RexaAgentAppMode[];
  selectedAppModeId?: string;
  onSelectAppMode?: (id: string) => void;
  appMode?: RexaAgentAppMode;
  isDetecting: boolean;
}) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize textarea to fit content
  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    const nextHeight = Math.min(textareaRef.current.scrollHeight, 200);
    textareaRef.current.style.height = `${nextHeight}px`;
  }, [input]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    onSend(input);
    setInput("");
  }, [input, isStreaming, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="px-3 pb-3 sm:px-4 sm:pb-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="mx-auto w-full min-w-0 max-w-3xl"
      >
        {/* Frame (1px padding = border effect, like t3code) */}
        <div className="group rounded-[22px] bg-border/50 p-px transition-colors duration-200">
          {/* Surface */}
          <div className="rounded-[20px] bg-card transition-[background-color] duration-200">
            {/* Prompt editor area — stays editable while the agent streams */}
            <div
              className="relative cursor-text px-3 pt-3.5 sm:px-3.5 sm:pt-4"
              onClick={() => textareaRef.current?.focus()}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about this database…"
                rows={1}
                className="block w-full resize-none border-0 bg-transparent px-0 py-0 text-sm leading-6 text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
                style={{ minHeight: "48px", maxHeight: "200px" }}
              />
            </div>

            {/* Footer: pickers + send share one 32px baseline, pinned to the bottom */}
            <div className="flex h-10 min-w-0 flex-nowrap items-end justify-between gap-2 overflow-visible px-2 pb-2">
              <div className="flex h-8 min-w-0 flex-1 items-end gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <AgentsModelPicker
                  providers={providers}
                  activeProvider={activeProvider}
                  onSelectProvider={onSelectProvider}
                  selectedModel={selectedModel}
                  onSelectModel={onSelectModel}
                  isDetecting={isDetecting}
                />
                <AgentsModePicker
                  modes={
                    providers.find((p) => p.id === activeProvider)?.modes ?? []
                  }
                  selectedMode={selectedMode}
                  onSelectMode={onSelectMode}
                  appModes={appModes}
                  selectedAppModeId={selectedAppModeId}
                  onSelectAppMode={onSelectAppMode}
                />
              </div>

              <div className="flex h-8 shrink-0 flex-nowrap items-end justify-end">
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={onStop}
                    aria-label="Stop generation"
                    className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs transition-all duration-150 hover:scale-105 hover:bg-destructive active:shadow-none"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <rect x="2" y="2" width="8" height="8" rx="1.5" />
                    </svg>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    aria-label="Send message"
                    className="relative flex size-8 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:hover:scale-105 enabled:hover:bg-primary/90 active:shadow-none disabled:pointer-events-none disabled:opacity-30"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
