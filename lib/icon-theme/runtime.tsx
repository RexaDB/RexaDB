"use client";

import { forwardRef, type ComponentType, type SVGProps } from "react";

import { useIconTheme } from "@/components/providers/icon-theme-provider";
import type { StoredSvgIcon } from "@/lib/icon-theme/types";

type LucideLikeProps = SVGProps<SVGSVGElement> & {
  absoluteStrokeWidth?: boolean;
  size?: string | number;
};

const SVG_ATTR_MAP: Record<string, keyof SVGProps<SVGSVGElement>> = {
  fill: "fill",
  stroke: "stroke",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
};

function mapSvgAttrs(attrs?: Record<string, string>) {
  const mapped: Record<string, string> = {};
  if (!attrs) return mapped;

  for (const [key, value] of Object.entries(attrs)) {
    const target = SVG_ATTR_MAP[key];
    if (target) {
      mapped[target] = value;
    }
  }

  return mapped;
}

function ThemedSvgIcon(
  { icon, absoluteStrokeWidth, className, color, size = 24, style, ...props }: LucideLikeProps & { icon: StoredSvgIcon },
  ref: React.ForwardedRef<SVGSVGElement>
) {
  void absoluteStrokeWidth;
  return (
    <svg
      {...mapSvgAttrs(icon.attrs)}
      {...props}
      ref={ref}
      className={className}
      color={color}
      height={size}
      style={style}
      viewBox={icon.viewBox || "0 0 24 24"}
      width={size}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}

const ForwardThemedSvgIcon = forwardRef(ThemedSvgIcon);

export function createThemedLucideIcon(name: string, Fallback: ComponentType<LucideLikeProps>) {
  const WrappedIcon = forwardRef<SVGSVGElement, LucideLikeProps>((props, ref) => {
    const { iconThemeId, customIconThemes } = useIconTheme();
    const activeTheme = customIconThemes.find((theme) => theme.id === iconThemeId);
    const customIcon = activeTheme?.icons[name];

    if (customIcon) {
      return <ForwardThemedSvgIcon {...props} icon={customIcon} ref={ref} />;
    }

    return <Fallback {...props} ref={ref} />;
  });

  WrappedIcon.displayName = `${name}IconThemeProxy`;
  return WrappedIcon;
}
