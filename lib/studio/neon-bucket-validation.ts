const NEON_BUCKET_NAME_RE = /^(?=.{3,63}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/;

export function validateNeonBucketName(name: string): string | null {
  const value = name.trim();
  const labels = value.split(".");
  const invalidLabel = labels.some(
    (label) => !label || label.startsWith("-") || label.endsWith("-"),
  );
  const ipv4Like = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
  if (!NEON_BUCKET_NAME_RE.test(value) || invalidLabel || ipv4Like) {
    return "Use 3–63 lowercase letters, numbers, dots, or hyphens; labels must not start or end with a hyphen.";
  }
  return null;
}
