"use client";
import { SplitView } from "./split-view";
import type { ReactNode } from "react";

export function HorizontalSplitView(props: {
  primary: ReactNode;
  secondary: ReactNode;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  minRatio?: number;
  maxRatio?: number;
}) {
  return <SplitView {...props} direction="vertical" />;
}
