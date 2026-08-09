export function extractProviderErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  const maybeResponseBody = (error as { responseBody?: unknown }).responseBody;
  if (typeof maybeResponseBody === "string") {
    try {
      const parsed = JSON.parse(maybeResponseBody) as {
        error?: { title?: string; message?: string; code?: string; metadata?: { raw?: string } };
      };
      if (parsed?.error) {
        const msg = parsed.error.message?.trim();
        const title = parsed.error.title?.trim();
        if (!msg && !title) return null;
        let result = title ? title : "";
        if (msg) {
          result = result ? `${result}: ${msg}` : msg;
        }
        if (parsed.error.metadata?.raw) {
          result = `${result}: ${parsed.error.metadata.raw}`;
        } else if (parsed.error.code) {
          result = `${result} (${parsed.error.code})`;
        }
        return result;
      }
    } catch {
      // Ignore JSON parse errors and fall back.
    }
  }

  const maybeData = (error as { data?: unknown }).data;
  if (maybeData && typeof maybeData === "object") {
    const message = (maybeData as { error?: { message?: string } }).error?.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return null;
}
