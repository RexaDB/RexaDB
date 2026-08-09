"use client";

export type AdvisorSeverity = "critical" | "warning" | "info";

export type AdvisorCategory = "performance" | "security" | "schema";

export interface AdvisorCheck {
  id: string;
  title: string;
  description: string;
  category: AdvisorCategory;
  severity: AdvisorSeverity;
  sql: string;
  requiresExtension?: string;
}

export interface AdvisorResult {
  check: AdvisorCheck;
  passed: boolean;
  detail: string;
  suggestion: string | null;
  sqlStatement: string | null;
  value?: number | string;
  meta?: Record<string, unknown>;
  rows?: any[];
}

export interface AdvisorCategorySummary {
  category: AdvisorCategory;
  label: string;
  icon: string;
  total: number;
  passed: number;
  warnings: number;
  critical: number;
  info: number;
}
