"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"

import { cn } from "@/lib/utils"
import { preventTextSelection, allowTextSelection } from "@/lib/prevent-text-selection"
import { Button } from "@/components/ui/button"
import { XIcon } from "@/lib/icon-theme/lucide-react"
import { ResizeHandle } from "@/components/app-shell/resize-handle"

/**
 * Set by a shell (e.g. ModernUIShell) to a DOM node that sits in the same
 * flex row as its content card. When present, a `contained` SheetContent
 * portals into it and renders as an in-flow docked panel (rounded card +
 * resize gutter, pushing/sitting beside the content) instead of floating
 * over it as a local absolutely-positioned overlay.
 */
const SheetDockContext = React.createContext<HTMLDivElement | null>(null)

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn("data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 bg-black/10 duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 z-40", className)}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  resizable = side === "right" || side === "left",
  minResizeWidth = 360,
  maxResizeWidth,
  resizeHandleLabel = "Resize sheet",
  style,
  contained = false,
  noOverlay = false,
  onInteractOutside: onInteractOutsideProp,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  resizable?: boolean
  minResizeWidth?: number
  maxResizeWidth?: number
  resizeHandleLabel?: string
  contained?: boolean
  /** Skip the dim/blur backdrop so the sheet floats like a docked panel. */
  noOverlay?: boolean
}) {
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const resizeHandleRef = React.useRef<HTMLDivElement | null>(null)
  const [resizedWidth, setResizedWidth] = React.useState<number | null>(null)
  const isSideSheet = side === "right" || side === "left"
  const dockContainer = React.useContext(SheetDockContext)
  const isDocked = contained && !!dockContainer

  // The docked ResizeHandle is a sibling that lives in the gutter *outside*
  // Content (matching the AI panel's own layout), so Radix's dismissable
  // layer sees a mousedown on it as an "outside" interaction and would close
  // the sheet mid-drag. Recognize and ignore that one element instead of
  // moving the handle inside the card, which would lose the real gutter gap.
  const handleInteractOutside = React.useCallback((event: any) => {
    const target = event.target as Node | null
    if (target && resizeHandleRef.current?.contains(target)) {
      event.preventDefault()
      return
    }
    // Non-modal Content ("contained") doesn't trap focus, so when this sheet
    // is opened from another overlay (e.g. a row-action dropdown menu item),
    // that overlay's own close returning focus to its trigger fires as a
    // "focusin outside" event here an instant after mount — not a real user
    // action to dismiss this sheet. Only genuine pointer clicks outside
    // should close it.
    if (contained && event?.detail?.originalEvent?.type === "focusin") {
      event.preventDefault()
      return
    }
    onInteractOutsideProp?.(event)
  }, [contained, onInteractOutsideProp])

  const getViewportMaxWidth = React.useCallback(() => {
    if (typeof window === "undefined") return maxResizeWidth ?? Number.POSITIVE_INFINITY
    const viewportLimit = Math.max(minResizeWidth, window.innerWidth - 24)
    return Math.max(minResizeWidth, Math.min(maxResizeWidth ?? viewportLimit, viewportLimit))
  }, [maxResizeWidth, minResizeWidth])

  const clampWidth = React.useCallback((value: number) => {
    return Math.max(minResizeWidth, Math.min(getViewportMaxWidth(), value))
  }, [getViewportMaxWidth, minResizeWidth])

  const startResize = React.useCallback((startClientX: number) => {
    if (!contentRef.current) return
    const startWidth = contentRef.current.getBoundingClientRect().width
    document.body.style.cursor = "col-resize"
    preventTextSelection()

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = side === "right" ? startClientX - moveEvent.clientX : moveEvent.clientX - startClientX
      const nextWidth = startWidth + delta
      setResizedWidth(clampWidth(nextWidth))
    }

    const stopResize = () => {
      document.body.style.cursor = ""
      allowTextSelection()
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", stopResize)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", stopResize)
  }, [clampWidth, side])

  const handleResizeMouseDown = React.useCallback((event: React.MouseEvent) => {
    if (!isSideSheet || !resizable) return
    event.preventDefault()
    startResize(event.clientX)
  }, [isSideSheet, resizable, startResize])

  React.useEffect(() => {
    if (!resizedWidth) return
    const handleWindowResize = () => {
      setResizedWidth((prev) => (prev ? clampWidth(prev) : prev))
    }
    window.addEventListener("resize", handleWindowResize)
    return () => window.removeEventListener("resize", handleWindowResize)
  }, [clampWidth, resizedWidth])

  const mergedStyle = {
    ...style,
    ...(isDocked ? { background: "var(--shell-content-bg)" } : {}),
    ...(resizedWidth ? { width: `${resizedWidth}px`, maxWidth: "none" } : {}),
  } as React.CSSProperties

  const Wrapper = contained && !isDocked ? React.Fragment : SheetPortal;
  // Radix's Portal renders its children inside its own plain `<div>` before
  // portaling that div into `container`. Left unstyled, that div is a normal
  // block box, so the ResizeHandle and the card would stack vertically inside
  // it instead of landing as side-by-side flex items of the dock row —
  // `contents` removes that box from layout so its children promote straight
  // into the (also `contents`) dock container's real flex parent.
  const wrapperProps = isDocked ? { container: dockContainer!, className: "contents" } : {};

  return (
    <Wrapper {...wrapperProps}>
      {contained || noOverlay ? null : <SheetOverlay />}
      {isDocked && resizable && isSideSheet && (
        <ResizeHandle
          ref={resizeHandleRef}
          orientation="vertical"
          onMouseDown={handleResizeMouseDown}
          className="mt-9"
        />
      )}
      <SheetPrimitive.Content
        ref={contentRef}
        onInteractOutside={handleInteractOutside}
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "bg-background flex flex-col gap-4 bg-clip-padding text-sm shadow-lg transition duration-200 ease-in-out",
          contained ? "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" : "data-[state=open]:animate-in data-[state=closed]:animate-out data-[side=right]:data-[state=closed]:slide-out-to-right-full data-[side=right]:data-[state=open]:slide-in-from-right-full data-[side=left]:data-[state=closed]:slide-out-to-left-full data-[side=left]:data-[state=open]:slide-in-from-left-full data-[side=top]:data-[state=closed]:slide-out-to-top-full data-[side=top]:data-[state=open]:slide-in-from-top-full data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:data-[state=closed]:slide-out-to-bottom-full data-[side=bottom]:data-[state=open]:slide-in-from-bottom-full",
          contained
            ? cn(
                "w-[min(350px,92vw)] rounded-lg border border-border",
                isDocked
                  ? "relative mt-9 min-h-0 shrink-0 overflow-hidden"
                  : "absolute top-1.5 right-1.5 bottom-1.5 z-50",
              )
            : cn(
                "fixed z-[60]",
                "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:pb-[calc(1rem+env(safe-area-inset-bottom))]",
                "data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r",
                "data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l",
                "data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b",
                "data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
              ),
          !contained && isSideSheet && side === "right" && "border-l-border",
          !contained && isSideSheet && side === "left" && "border-r-border",
          className
        )}
        style={mergedStyle}
        {...props}
      >
        {resizable && isSideSheet && contained && !isDocked && (
          // Absolute-contained fallback (no dock context, e.g. New Layout):
          // no shell row to put a sibling gutter in, so this stays an
          // in-Content edge strip like the classic overlay sheets below.
          <ResizeHandle
            orientation="vertical"
            onMouseDown={handleResizeMouseDown}
            aria-label={resizeHandleLabel}
            className={cn("absolute top-0 h-full z-[70]", side === "right" ? "left-0" : "right-0")}
          />
        )}
        {resizable && isSideSheet && !contained && (
          // Floating overlay sheets get the same VS Code sash as docked
          // sheets and sidebars: hover line + resting dots affordance.
          <ResizeHandle
            orientation="vertical"
            onMouseDown={handleResizeMouseDown}
            aria-label={resizeHandleLabel}
            className={cn("absolute top-0 h-full z-[70]", side === "right" ? "left-0" : "right-0")}
          />
        )}
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button variant="ghost" className="absolute top-3 right-3" size="icon-sm">
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </Wrapper>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("gap-0.5 p-4 flex flex-col", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("gap-2 p-4 mt-auto flex flex-col", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground text-sm font-medium", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetDockContext,
}
