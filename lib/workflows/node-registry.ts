import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { NODE_REGISTRY, NODE_REGISTRY_MAP, NODE_CATEGORIES, IMPLEMENTED_NODES } from "./node-registry-data";
import type { NodeCategory, FieldType, FieldDef, NodeDef } from "./node-registry-data";

export { NODE_REGISTRY, NODE_REGISTRY_MAP, NODE_CATEGORIES, IMPLEMENTED_NODES };
export type { NodeCategory, FieldType, FieldDef, NodeDef };

export function getNodeDef(type: string): NodeDef | undefined {
  return NODE_REGISTRY_MAP.get(type);
}

export function getNodeIcon(iconName: string): LucideIcon {
  return (LucideIcons as unknown as Record<string, LucideIcon>)[iconName] ?? LucideIcons.Workflow;
}

export function getDefaultConfig(type: string): Record<string, unknown> {
  const def = getNodeDef(type);
  if (!def) return {};
  const config: Record<string, unknown> = {};
  for (const field of def.fields) {
    if (field.defaultValue !== undefined) config[field.key] = field.defaultValue;
  }
  return config;
}
