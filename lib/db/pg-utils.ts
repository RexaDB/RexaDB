export function extractIndexColumns(definition: string): string[] {
  const match = definition.match(/\((.*)\)/);
  return match
    ? match[1].split(",").map((c: string) => c.trim().replace(/"/g, ""))
    : [];
}
