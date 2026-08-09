export function toRolesArray(input: string | string[] | null): string[] {
  if (Array.isArray(input)) return input;
  if (!input) return [];

  const text = String(input).trim();
  if (!text) return [];

  if (text.startsWith("{") && text.endsWith("}")) {
    return text
      .slice(1, -1)
      .split(",")
      .map(role => role.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }

  return text
    .split(",")
    .map(role => role.trim())
    .filter(Boolean);
}
