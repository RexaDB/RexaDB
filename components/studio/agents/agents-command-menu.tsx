"use client";

import { useMemo, useState } from "react";
import { FileText, Plus } from "@/lib/icon-theme/lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { defaultFilter } from "cmdk";

interface AgentsCommandMenuThread {
  id: string;
  title: string;
  updatedAt: number;
}

export function AgentsCommandMenu({
  isOpen,
  onOpenChange,
  threads,
  activeThread,
  onSelectThread,
  onNewThread,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  threads: AgentsCommandMenuThread[];
  activeThread: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
}) {
  const [search, setSearch] = useState("");

  const sortedThreads = useMemo(
    () => [...threads].sort((a, b) => b.updatedAt - a.updatedAt),
    [threads],
  );

  const filteredThreads = useMemo(() => {
    if (!search) return sortedThreads;
    return sortedThreads
      .map((thread) => ({
        thread,
        score: defaultFilter(thread.title, search, []),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.thread);
  }, [sortedThreads, search]);

  const select = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) setSearch("");
    onOpenChange(open);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        className="overflow-hidden rounded-lg border border-studio-border bg-studio-bg p-0 pb-10 shadow-2xl data-[state=open]:animate-cmd-enter data-[state=closed]:animate-cmd-exit sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search threads or start a new one.
        </DialogDescription>

        <Command
          shouldFilter={false}
          className="rounded-none bg-transparent **:data-[selected=true]:bg-muted **:data-[selected=true]:text-foreground"
        >
          <CommandInput
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder="Search threads..."
          />
          <CommandList className="no-scrollbar max-h-80 min-h-80">
            <CommandEmpty>No matching threads.</CommandEmpty>

            <CommandGroup heading="Actions">
              <CommandItem
                value="new-thread"
                keywords={["new", "thread", "session", "chat"]}
                onSelect={() => select(onNewThread)}
              >
                <Plus aria-hidden="true" />
                <span>New Thread</span>
              </CommandItem>
            </CommandGroup>

            {filteredThreads.length > 0 && (
              <>
                <CommandSeparator alwaysRender />
                <CommandGroup heading="Threads">
                  {filteredThreads.map((thread) => (
                    <CommandItem
                      key={thread.id}
                      value={`thread-${thread.id}`}
                      keywords={[thread.title]}
                      data-selected={thread.id === activeThread || undefined}
                      onSelect={() => select(() => onSelectThread(thread.id))}
                    >
                      <FileText aria-hidden="true" />
                      <span className="truncate">{thread.title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>

        <div className="absolute inset-x-0 bottom-0 z-20 flex h-10 items-center gap-2 border-t border-studio-border bg-studio-bg px-4 font-medium text-muted-foreground text-xs">
          <Kbd>Enter</Kbd>
          Select
        </div>
      </DialogContent>
    </Dialog>
  );
}
