export function ok(data: unknown) {
  return { ok: true, data, error: null };
}

export function fail(error: unknown) {
  return { ok: false, data: null, error: error instanceof Error ? error.message : String(error || "Unknown error") };
}
