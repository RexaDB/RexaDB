import { getTableLabels } from "@/lib/studio/db-labels";

export async function copyItemName(name: string, itemNoun: string) {
  try {
    await navigator.clipboard.writeText(name);
  } catch (error) {
    console.error(`Failed to copy ${itemNoun.toLowerCase()} name:`, error);
  }
}

export function getTableDerivedValues(dbType: string) {
  const isMongo = dbType === "mongodb";
  const isRedis = dbType === "redis";
  const labels = getTableLabels(dbType as any);
  const itemNoun = labels.singular;
  const copyDefinitionLabel = isMongo
    ? "Copy Collection Definition"
    : isRedis
      ? "Copy Key Name"
      : "Copy SQL Definition";
  const canExportSql = !isMongo && !isRedis;
  return { isMongo, isRedis, itemNoun, copyDefinitionLabel, canExportSql };
}
