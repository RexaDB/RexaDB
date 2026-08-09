"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"

import { cn } from "@/lib/utils"
import { preventTextSelection, allowTextSelection } from "@/lib/prevent-text-selection"
import { Button } from "@/components/ui/button"
import { XIcon } from "@/lib/icon-theme/lucide-react"

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
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  resizable?: boolean
  minResizeWidth?: number
  maxResizeWidth?: number
  resizeHandleLabel?: string
  contained?: boolean
}) {
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const [isResizing, setIsResizing] = React.useState(false)
  const [isResizeHovered, setIsResizeHovered] = React.useState(false)
  const [resizedWidth, setResizedWidth] = React.useState<number | null>(null)
  const isSideSheet = side === "right" || side === "left"

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
    setIsResizing(true)
    document.body.style.cursor = "col-resize"
    preventTextSelection()

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = side === "right" ? startClientX - moveEvent.clientX : moveEvent.clientX - startClientX
      const nextWidth = startWidth + delta
      setResizedWidth(clampWidth(nextWidth))
    }

    const stopResize = () => {
      setIsResizing(false)
      document.body.style.cursor = ""
      allowTextSelection()
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", stopResize)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", stopResize)
  }, [clampWidth, side])

  const handleResizeMouseDown = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
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
    ...(resizedWidth ? { width: `${resizedWidth}px`, maxWidth: "none" } : {}),
  } as React.CSSProperties

  const Wrapper = contained ? React.Fragment : SheetPortal;

  return (
    <Wrapper>
      {contained ? null : <SheetOverlay />}
      <SheetPrimitive.Content
        ref={contentRef}
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "bg-background flex flex-col gap-4 bg-clip-padding text-sm shadow-lg transition duration-200 ease-in-out",
          contained ? "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" : "data-[state=open]:animate-in data-[state=closed]:animate-out data-[side=right]:data-[state=closed]:slide-out-to-right-full data-[side=right]:data-[state=open]:slide-in-from-right-full data-[side=left]:data-[state=closed]:slide-out-to-left-full data-[side=left]:data-[state=open]:slide-in-from-left-full data-[side=top]:data-[state=closed]:slide-out-to-top-full data-[side=top]:data-[state=open]:slide-in-from-top-full data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:data-[state=closed]:slide-out-to-bottom-full data-[side=bottom]:data-[state=open]:slide-in-from-bottom-full",
          contained
            ? "absolute inset-y-0 right-0 z-50 rounded-l-xl border-l w-[min(350px,100%)]"
            : cn(
                "fixed z-[60]",
                "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:pb-[calc(1rem+env(safe-area-inset-bottom))]",
                "data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r",
                "data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l",
                "data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b",
                "data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
              ),
          isSideSheet && side === "right" && (isResizeHovered ? "border-l-blue-500/60" : "border-l-border"),
          isSideSheet && side === "left" && (isResizeHovered ? "border-r-blue-500/60" : "border-r-border"),
          className
        )}
        style={mergedStyle}
        {...props}
      >
        {resizable && isSideSheet && (
          <div
            role="separator"
            aria-label={resizeHandleLabel}
            aria-orientation="vertical"
            onMouseDown={handleResizeMouseDown}
            onMouseEnter={() => setIsResizeHovered(true)}
            onMouseLeave={() => setIsResizeHovered(false)}
            className={cn(
              "absolute top-0 z-[70] h-full w-3 cursor-col-resize select-none bg-transparent",
              side === "right" ? "left-0" : "right-0",
              isResizing && "bg-transparent"
            )}
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
}
