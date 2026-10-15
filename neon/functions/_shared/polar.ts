/** Polar API base: sandbox when POLAR_ENV=sandbox, else production. */
export function resolvePolarBaseUrl(): string {
  return process.env.POLAR_ENV === "sandbox"
    ? "https://sandbox-api.polar.sh"
    : "https://api.polar.sh";
}

/** Minimal typed Polar REST client (reconstructed from _shared/polar.ts usage). */
export async function polarRequest<T>(
  accessToken: string,
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${resolvePolarBaseUrl()}/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Polar ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}
