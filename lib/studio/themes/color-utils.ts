function srgbTransfer(c: number): number {
  const v = Math.abs(c);
  return v > 0.0031308
    ? 1.055 * Math.pow(v, 1 / 2.4) - 0.055
    : 12.92 * v;
}

function srgbTransferInv(c: number): number {
  const v = Math.abs(c);
  return v > 0.04045
    ? Math.pow((v + 0.055) / 1.055, 2.4)
    : v / 12.92;
}

function parseHexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let clean = hex.replace("#", "");
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  if (clean.length !== 6) return null;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r: r / 255, g: g / 255, b: b / 255 };
}

export function isValidColor(s: string): boolean {
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s)) return true;
  if (/^rgba?\(/.test(s)) return true;
  if (/^oklch\(/.test(s)) return true;
  return false;
}

export function hexToOklch(hex: string): { L: number; C: number; h: number } | null {
  const rgb = parseHexToRgb(hex);
  if (!rgb) return null;

  const r = srgbTransferInv(rgb.r);
  const g = srgbTransferInv(rgb.g);
  const b = srgbTransferInv(rgb.b);

  const l_ = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m_ = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s_ = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l = Math.cbrt(l_);
  const m = Math.cbrt(m_);
  const s = Math.cbrt(s_);

  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const b_ = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

  const C = Math.sqrt(a * a + b_ * b_);
  const h = (Math.atan2(b_, a) * 180) / Math.PI;
  return { L, C, h: h < 0 ? h + 360 : h };
}

export function oklchToHex(L: number, C: number, h: number): string {
  const hRad = (h * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b_ = C * Math.sin(hRad);

  const l = L + 0.3963377774 * a + 0.2158037573 * b_;
  const m = L - 0.1055613458 * a - 0.0638541728 * b_;
  const s = L - 0.0894841775 * a - 1.2914855480 * b_;

  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;

  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const b_comp = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(srgbTransfer(v) * 255)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b_comp).toString(16).padStart(2, "0")}`;
}

export function adjustColor(
  hex: string,
  delta: { L?: number; C?: number; h?: number },
): string {
  const oklch = hexToOklch(hex);
  if (!oklch) return hex;
  return oklchToHex(
    Math.min(1, Math.max(0, oklch.L + (delta.L ?? 0))),
    Math.min(0.4, Math.max(0, oklch.C + (delta.C ?? 0))),
    ((oklch.h + (delta.h ?? 0)) % 360 + 360) % 360,
  );
}

export function lighten(hex: string, amount: number): string {
  return adjustColor(hex, { L: amount / 100 });
}

export function darken(hex: string, amount: number): string {
  return adjustColor(hex, { L: -(amount / 100) });
}

export function saturate(hex: string, amount: number): string {
  return adjustColor(hex, { C: amount });
}

export function desaturate(hex: string, amount: number): string {
  return adjustColor(hex, { C: -amount });
}

export function hueRotate(hex: string, degrees: number): string {
  return adjustColor(hex, { h: degrees });
}

export function luminance(hex: string): number {
  const rgb = parseHexToRgb(hex);
  if (!rgb) return 0.5;
  const r = srgbTransferInv(rgb.r);
  const g = srgbTransferInv(rgb.g);
  const b = srgbTransferInv(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastForeground(bg: string): "#ffffff" | "#000000" {
  const lum = luminance(bg);
  return lum > 0.179 ? "#000000" : "#ffffff";
}

/** Append alpha to a 6-digit hex color (`#rrggbb` → `#rrggbbaa`). */
export function hexAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  const base = hex.replace("#", "").slice(0, 6);
  return `#${base}${a}`;
}

export function alpha(hex: string, a: number): string {
  const rgb = parseHexToRgb(hex);
  if (!rgb) return hex;
  const to255 = (v: number) => Math.round(v * 255);
  return `rgba(${to255(rgb.r)},${to255(rgb.g)},${to255(rgb.b)},${a})`;
}

export function pickColor(
  colors: Record<string, string>,
  keys: string[],
  fallback: string,
): string {
  for (const key of keys) {
    const v = colors[key];
    if (v && isValidColor(v)) return v;
  }
  return fallback;
}
