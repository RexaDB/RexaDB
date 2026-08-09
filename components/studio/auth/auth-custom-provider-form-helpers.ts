export function arrayToCsv(values: string[] | null | undefined) {
  return (values || []).join(", ");
}

export function csvToArray(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function generateUuid() {
  type CryptoLike = {
    randomUUID?: () => string;
    getRandomValues?: (array: Uint8Array) => Uint8Array;
  };
  const cryptoObj =
    typeof globalThis !== "undefined"
      ? (globalThis as { crypto?: CryptoLike }).crypto
      : undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `fallback-${Date.now()}`;
}
