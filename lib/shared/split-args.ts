export interface SplitArgsOptions {
  quoteChars?: string[];
  delimiter?: "space" | "comma";
  respectEscapes?: boolean;
}

export function createTokenizer(options: SplitArgsOptions = {}): (input: string) => string[] {
  const {
    quoteChars = ['"', "'"],
    delimiter = "space",
    respectEscapes = true,
  } = options;

  const quoteSet = new Set(quoteChars);

  return (input: string): string[] => {
    const raw = String(input || "").trim();
    if (!raw) return [];
    const out: string[] = [];

    let current = "";
    let quote: string | null = null;
    let escape = false;

    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (escape) {
        current += ch;
        escape = false;
        continue;
      }
      if (respectEscapes && ch === "\\") {
        escape = true;
        continue;
      }
      if (quote) {
        if (ch === quote) {
          quote = null;
        } else {
          current += ch;
        }
        continue;
      }
      if (quoteSet.has(ch)) {
        quote = ch;
        continue;
      }
      if (delimiter === "comma") {
        if (ch === ",") {
          out.push(current.trim());
          current = "";
          continue;
        }
      } else {
        if (/\s/.test(ch)) {
          if (current) {
            out.push(current);
            current = "";
          }
          continue;
        }
      }
      current += ch;
    }
    if (current.trim()) out.push(current.trim());
    return out;
  };
}
