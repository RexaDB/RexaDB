export const resolvePolarBaseUrl = (): string => {
  const explicit = Deno.env.get("POLAR_API_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const env = (Deno.env.get("POLAR_ENV") ?? "production").toLowerCase();
  return env === "sandbox" ? "https://sandbox-api.polar.sh/v1" : "https://api.polar.sh/v1";
};

export const polarRequest = async <T>(
  accessToken: string,
  path: string,
  method: "POST" | "GET" | "PATCH",
  body?: Record<string, unknown>,
): Promise<T> => {
  const url = `${resolvePolarBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Polar API ${method} ${path} failed (${res.status}): ${text}`);
  }

  return (await res.json()) as T;
};
