"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";

import { cn } from "@/lib/utils";
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "@/lib/icon-theme/lucide-react";

type SelectSearchContextValue = {
  enabled: boolean;
  normalizedQuery: string;
};

const SelectSearchContext = React.createContext<SelectSearchContextValue>({
  enabled: false,
  normalizedQuery: "",
});

function extractText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join(" ");
  if (React.isValidElement(node)) {
    return extractText(
      (node as React.ReactElement<{ children?: React.ReactNode }>).props
        .children,
    );
  }
  return "";
}

function matchesSelectQuery(label: string, query: string): boolean {
  if (!query) return true;

  const normalizedLabel = label.toLowerCase();
  if (normalizedLabel.startsWith(query)) return true;

  // Faster check for simple inclusion before doing token splitting.
  if (query.length >= 2 && normalizedLabel.includes(query)) {
    // If it's included, it might be a token match or just a substring.
    // We still check tokens for precision if it doesn't start with the query.
    const tokens = normalizedLabel.split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.some((token) => token.startsWith(query))) return true;

    return true; // Fallback to substring match for 2+ chars
  }

  // Single character fallback token check.
  if (query.length === 1) {
    const tokens = normalizedLabel.split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.some((token) => token.startsWith(query))) return true;
  }

  return false;
}

function collectSelectItemLabels(children: React.ReactNode): string[] {
  const labels: string[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const element = child as React.ReactElement<{
      children?: React.ReactNode;
      value?: string;
      type?: any;
    }>;

    // Most reliable: check if it has a 'value' prop, which SelectItem must have.
    // Also check for the 'select-item' data attribute.
    if (
      element.props?.value !== undefined ||
      (element.props as any)?.["data-slot"] === "select-item"
    ) {
      labels.push(extractText(element.props.children));
      return;
    }

    if (element.props?.children) {
      labels.push(...collectSelectItemLabels(element.props.children));
    }
  });
  return labels;
}

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  );
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-border focus-visible:ring-0 focus-visible:ring-inset aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 gap-1.5 rounded-lg border bg-transparent py-2 pr-2 pl-2.5 text-sm transition-colors select-none focus-visible:ring-0 aria-invalid:ring-3 data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:gap-1.5 [&_svg:not([class*='size-'])]:size-4 flex w-fit items-center justify-between whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="text-muted-foreground size-4 pointer-events-none" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  searchThreshold = 0,
  searchPlaceholder = "Search options...",
  emptyText = "No options found.",
  sideOffset,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  searchThreshold?: number;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const [query, setQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(query);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Memoize labels extraction based on children.
  // Note: if children is unstable, this still runs frequently, but it's better than nothing.
  const labels = React.useMemo(
    () => collectSelectItemLabels(children),
    [children],
  );
  const stopKeyEvent = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();

      // Also stop the native event so Radix doesn't typeahead on letters
      if ("stopImmediatePropagation" in event.nativeEvent) {
        event.nativeEvent.stopImmediatePropagation();
      }
    },
    [],
  );
  const showSearch = searchThreshold >= 0 && labels.length >= searchThreshold;
  const effectivePosition = showSearch ? "popper" : position;
  const effectiveAlign = showSearch ? "start" : align;
  const effectiveSideOffset = sideOffset ?? (showSearch ? 6 : 0);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const hasMatches =
    normalizedQuery.length === 0 ||
    labels.some((label) => matchesSelectQuery(label, normalizedQuery));

  const stopSearchEventPropagation = React.useCallback(
    (event: React.SyntheticEvent) => {
      event.stopPropagation();
    },
    [],
  );

  const stopPointerDown = React.useCallback((event: React.PointerEvent) => {
    event.stopPropagation();
    // Avoid Radix focusing another item when clicking the input
  }, []);

  React.useEffect(() => {
    if (!showSearch) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement !== searchInputRef.current) {
        searchInputRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [showSearch, normalizedQuery]); // Also run when query changes, just in case focus was lost

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={effectivePosition === "item-aligned"}
        className={cn(
          "bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 min-w-36 rounded-lg shadow-md ring-1 duration-100 relative z-[80] max-h-[min(20rem,var(--radix-select-content-available-height))] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto data-[align-trigger=true]:animate-none",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={effectivePosition}
        align={effectiveAlign}
        sideOffset={effectiveSideOffset}
        {...props}
      >
        {showSearch && (
          <div className="border-b border-border px-2 py-1">
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDownCapture={stopKeyEvent}
              onKeyUpCapture={stopKeyEvent}
              onKeyPressCapture={stopKeyEvent}
              onKeyDown={stopKeyEvent}
              onKeyUp={stopKeyEvent}
              onKeyPress={stopKeyEvent}
              onPointerDownCapture={stopPointerDown}
              onPointerDown={stopPointerDown}
              onMouseDownCapture={stopSearchEventPropagation}
              onMouseDown={stopSearchEventPropagation}
              onClick={stopSearchEventPropagation}
              placeholder={searchPlaceholder}
              className="h-5 w-full rounded-lg bg-transparent text-xs text-foreground placeholder:text-muted-foreground/70 outline-none"
            />
          </div>
        )}
        <SelectPrimitive.Viewport
          data-position={effectivePosition}
          className={cn(
            "max-h-[min(20rem,var(--radix-select-content-available-height))] data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)",
            effectivePosition === "popper" && "",
          )}
        >
          <SelectSearchContext.Provider
            value={{ enabled: showSearch, normalizedQuery }}
          >
            {children}
            {showSearch && normalizedQuery.length > 0 && !hasMatches && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {emptyText}
              </div>
            )}
          </SelectSearchContext.Provider>
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("text-muted-foreground px-1.5 py-1 text-xs", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  const { enabled, normalizedQuery } = React.useContext(SelectSearchContext);

  // Pre-calculate label and visibility.
  const label = React.useMemo(() => extractText(children), [children]);
  const isVisible = React.useMemo(() => {
    if (!enabled || !normalizedQuery) return true;
    return matchesSelectQuery(label, normalizedQuery);
  }, [enabled, normalizedQuery, label]);

  if (!isVisible) return null;

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground gap-1.5 rounded-lg py-1 pr-8 pl-1.5 text-sm [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2 relative flex w-full cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

SelectItem.displayName = "SelectItem";

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border -mx-1 my-1 h-px pointer-events-none", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "bg-popover z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "bg-popover z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
