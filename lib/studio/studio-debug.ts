export function logStudioDebug(message: string, payload?: unknown) {
  if (payload !== undefined) {
    console.log("[studio]", message, payload);
  } else {
    console.log("[studio]", message);
  }
}
