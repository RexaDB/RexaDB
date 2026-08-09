type TrinoConnectionInfo = {
  catalog: string;
  schema: string;
};

export function getTrinoConnectionInfo(connectionString: string): TrinoConnectionInfo {
  try {
    const parsed = new URL(String(connectionString || "").trim());
    return {
      catalog: parsed.searchParams.get("catalog") || "system",
      schema: parsed.searchParams.get("schema") || "information_schema",
    };
  } catch {
    return {
      catalog: "system",
      schema: "information_schema",
    };
  }
}
