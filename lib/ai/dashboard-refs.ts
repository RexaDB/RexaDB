export function buildDashboardRef(name: string, id?: string) {
  const slug = String(name || "dashboard")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "dashboard";

  const suffix = String(id || "").trim().slice(0, 6).toLowerCase();
  return suffix ? `dashboard.${slug}-${suffix}` : `dashboard.${slug}`;
}
