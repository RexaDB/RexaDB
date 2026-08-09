"use client";

import { Check, ChevronsUpDown } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";

interface SchemaDropdownProps {
  schemas: string[];
  selectedSchema: string;
  onSchemaChange: (schema: string) => void;
  showAllOption?: boolean;
}

export function SchemaDropdown({
  schemas,
  selectedSchema,
  onSchemaChange,
  showAllOption = true,
}: SchemaDropdownProps) {
  const [open, setOpen] = useState(false);
  const filteredSchemas = schemas.filter((s) => !s.startsWith("pg_"));

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="[&>span]:w-full pr-1! space-x-1 h-8"
          size="sm"
        >
          <div className="w-full flex gap-1">
            <span className="text-muted-foreground">schema</span>
            <span className="text-foreground">
              {selectedSchema === "all" ? "All schemas" : selectedSchema}
            </span>
          </div>
          <ChevronsUpDown
            className="text-muted-foreground"
            strokeWidth={2}
            size={14}
            data-icon="inline-end"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 min-w-[200px] pointer-events-auto"
        side="bottom"
        align="start"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <Command>
          <CommandInput className="h-7 py-1 text-xs" placeholder="Find schema..." />
          <CommandList>
            <CommandEmpty>No schemas found</CommandEmpty>
            <CommandGroup>
              <ScrollArea className={filteredSchemas.length > 7 ? "h-[210px]" : ""}>
                {showAllOption && (
                  <CommandItem
                    key="all"
                    className="cursor-pointer flex items-center justify-between space-x-2 w-full py-1 text-xs"
                    onSelect={() => {
                      onSchemaChange("all");
                      setOpen(false);
                    }}
                    onClick={() => {
                      onSchemaChange("all");
                      setOpen(false);
                    }}
                  >
                    <span>All schemas</span>
                    {selectedSchema === "all" && (
                      <Check className="text-primary" strokeWidth={2} size={14} />
                    )}
                  </CommandItem>
                )}
                {filteredSchemas.map((s) => (
                  <CommandItem
                    key={s}
                    className="cursor-pointer flex items-center justify-between space-x-2 w-full py-1 text-xs"
                    onSelect={() => {
                      onSchemaChange(s);
                      setOpen(false);
                    }}
                    onClick={() => {
                      onSchemaChange(s);
                      setOpen(false);
                    }}
                  >
                    <span>{s}</span>
                    {selectedSchema === s && (
                      <Check className="text-primary" strokeWidth={2} size={14} />
                    )}
                  </CommandItem>
                ))}
              </ScrollArea>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
