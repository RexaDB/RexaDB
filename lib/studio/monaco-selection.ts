/** Monaco cannot resolve CSS color-mix(), so mirror the dark text-selection mix in hex. */
export function darkMonacoSelection(primary: string, foreground: string, background: string) {
  const channels = (value: string, fallback: string) => {
    const hex = /^#[\da-f]{6}$/i.test(value) ? value : fallback;
    return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  };
  const accent = channels(primary, "#3b82f6");
  const text = channels(foreground, "#e2e2e2");
  const selection = accent.map((channel, index) =>
    Math.round(channel * 0.55 + text[index] * 0.45).toString(16).padStart(2, "0"),
  );
  return { background: `#${selection.join("")}`, foreground: background };
}
