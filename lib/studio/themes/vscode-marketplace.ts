import JSZip from "jszip";

function stripJsonComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === '"') { j++; break; }
        j++;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "'") { j++; break; }
        j++;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "/" && next === "/") {
      let j = i + 2;
      while (j < text.length && text[j] !== "\n") j++;
      out += "\n";
      i = j;
      continue;
    }
    if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < text.length - 1 && !(text[j] === "*" && text[j + 1] === "/")) j++;
      j += 2;
      const nl = text.slice(i, j).match(/\n/g);
      out += nl ? nl.join("") : "";
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function parseJsonWithComments(text: string): unknown {
  let clean = stripJsonComments(text);
  clean = clean.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(clean);
}

const OPEN_VSX_BASE = "https://open-vsx.org/api";

interface VsCodeExtensionRaw {
  namespace: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  downloadCount: number;
  averageRating?: number;
  reviewCount?: number;
  verified?: boolean;
  files: Record<string, string>;
}

interface OpenVsxSearchResponse {
  totalSize: number;
  offset: number;
  extensions: VsCodeExtensionRaw[];
}

export type VsCodeThemeEntry = {
  id: string;
  extensionName: string;
  namespace: string;
  publisher: string;
  label: string;
  description: string;
  version: string;
  downloadCount: number;
  themePath: string;
  uiTheme: string;
};

export type VsCodeExtensionEntry = {
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  downloadCount: number;
  averageRating: number;
  reviewCount: number;
  verified: boolean;
};

function getVsixUrl(entry: VsCodeThemeEntry): string {
  const filename = `${entry.namespace}.${entry.extensionName}-${entry.version}.vsix`;
  return `${OPEN_VSX_BASE}/${entry.namespace}/${entry.extensionName}/${entry.version}/file/${filename}`;
}

const searchCache = new Map<string, { data: VsCodeThemeEntry[]; total: number; ts: number }>();
const vsixCache = new Map<string, { zip: JSZip; ts: number }>();
const SEARCH_CACHE_TTL = 5 * 60 * 1000;
const VSIX_CACHE_TTL = 30 * 60 * 1000;

async function getVsixZip(entry: VsCodeThemeEntry): Promise<JSZip | null> {
  const cacheKey = `${entry.namespace}/${entry.extensionName}/${entry.version}`;
  const cached = vsixCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < VSIX_CACHE_TTL) {
    return cached.zip;
  }
  try {
    const url = getVsixUrl(entry);
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    vsixCache.set(cacheKey, { zip, ts: Date.now() });
    return zip;
  } catch {
    return null;
  }
}

async function fetchOpenVsxSearch(query: string, offset: number, size: number): Promise<OpenVsxSearchResponse> {
  const params = new URLSearchParams({
    size: String(size),
    offset: String(offset),
    category: "Themes",
  });
  if (query) params.set("query", query);
  const res = await fetch(`${OPEN_VSX_BASE}/-/search?${params}`);
  if (!res.ok) throw new Error(`Open VSX search failed: ${res.status} ${res.statusText}`);
  const body: OpenVsxSearchResponse = await res.json();
  if (!body.extensions || !Array.isArray(body.extensions)) {
    throw new Error("Invalid response from Open VSX");
  }
  return body;
}

export async function searchVsCodeThemes(
  query: string,
  offset = 0,
  size = 20,
): Promise<{ entries: VsCodeThemeEntry[]; total: number; error: string | null }> {
  const cacheKey = `${query}:${offset}:${size}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) {
    return { entries: cached.data, total: cached.total, error: null };
  }

  try {
    const body = await fetchOpenVsxSearch(query, offset, size);

    const manifestPromises = body.extensions.map(async (ext) => {
      try {
        const manifestUrl = `${OPEN_VSX_BASE}/${ext.namespace}/${ext.name}/${ext.version}/file/manifest`;
        const manifestRes = await fetch(manifestUrl);
        if (!manifestRes.ok) return { ext, themes: [] as { path: string; label: string; uiTheme: string }[] };
        const manifest = await manifestRes.json();
        const themeContributions = manifest?.contributes?.themes;
        if (!Array.isArray(themeContributions)) return { ext, themes: [] };
        return {
          ext,
          themes: themeContributions.map((t: any) => ({
            path: t.path,
            label: t.label || ext.displayName,
            uiTheme: t.uiTheme || "vs-dark",
          })),
        };
  } catch {
    return { ext, themes: [] as { path: string; label: string; uiTheme: string }[] };
  }
});

    const results = await Promise.all(manifestPromises);

    const entries: VsCodeThemeEntry[] = [];
    for (const { ext, themes } of results) {
      for (const theme of themes) {
        entries.push({
          id: `${ext.namespace}.${ext.name}/${theme.path}`,
          extensionName: ext.name,
          namespace: ext.namespace,
          publisher: ext.namespace,
          label: theme.label,
          description: ext.description,
          version: ext.version,
          downloadCount: ext.downloadCount,
          themePath: theme.path,
          uiTheme: theme.uiTheme,
        });
      }
    }

    searchCache.set(cacheKey, { data: entries, total: body.totalSize, ts: Date.now() });
    return { entries, total: body.totalSize, error: null };
  } catch (err) {
    return { entries: [], total: 0, error: (err as Error).message };
  }
}

export async function searchThemeExtensions(
  query: string,
  offset = 0,
  size = 50,
): Promise<{ extensions: VsCodeExtensionEntry[]; total: number; error: string | null }> {
  try {
    const body = await fetchOpenVsxSearch(query, offset, size);

    const extensions: VsCodeExtensionEntry[] = body.extensions.map((ext) => ({
      namespace: ext.namespace,
      name: ext.name,
      displayName: ext.displayName || ext.name,
      description: ext.description || "",
      version: ext.version,
      downloadCount: ext.downloadCount,
      averageRating: ext.averageRating || 0,
      reviewCount: ext.reviewCount || 0,
      verified: ext.verified || false,
    }));

    return { extensions, total: body.totalSize, error: null };
  } catch (err) {
    return { extensions: [], total: 0, error: (err as Error).message };
  }
}

export async function fetchVsCodeThemeJson(
  entry: VsCodeThemeEntry,
): Promise<{ json: Record<string, unknown> | null; error: string | null }> {
  try {
    const zip = await getVsixZip(entry);
    if (!zip) throw new Error("Failed to download extension package");

    const themePath = entry.themePath.replace(/^\.\//, "");
    const vsixPath = `extension/${themePath}`;
    const file = zip.file(vsixPath);
    if (!file) throw new Error(`Theme file not found: ${vsixPath}`);

    const content = await file.async("string");
    const json = parseJsonWithComments(content) as Record<string, unknown>;
    return { json, error: null };
  } catch (err) {
    return { json: null, error: (err as Error).message };
  }
}

export async function installExtensionThemes(
  ns: string,
  name: string,
  version: string,
): Promise<{
  themes: Array<{ name: string; uiTheme: string; json: Record<string, unknown> }>;
  error: string | null;
}> {
  try {
    const filename = `${ns}.${name}-${version}.vsix`;
    const url = `${OPEN_VSX_BASE}/${ns}/${name}/${version}/file/${filename}`;
    const cacheKey = `${ns}/${name}/${version}`;
    const cached = vsixCache.get(cacheKey);
    let zip: JSZip;
    if (cached && Date.now() - cached.ts < VSIX_CACHE_TTL) {
      zip = cached.zip;
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to download VSIX: ${res.status}`);
      const buf = await res.arrayBuffer();
      zip = await JSZip.loadAsync(buf);
      vsixCache.set(cacheKey, { zip, ts: Date.now() });
    }

    const manifestFile = zip.file("extension/package.json");
    if (!manifestFile) throw new Error("No package.json in VSIX");
    const manifestText = await manifestFile.async("string");
    const manifest = JSON.parse(manifestText);
    const themeContribs = manifest?.contributes?.themes;
    if (!Array.isArray(themeContribs) || themeContribs.length === 0) {
      throw new Error("No theme contributions found in extension");
    }

    const themes: Array<{ name: string; uiTheme: string; json: Record<string, unknown> }> = [];
    for (const tc of themeContribs) {
      const tPath = (tc.path as string).replace(/^\.\//, "");
      const vsixPath = `extension/${tPath}`;
      const file = zip.file(vsixPath);
      if (!file) {
        console.warn(`Theme file not found in VSIX: ${vsixPath}`);
        continue;
      }
      const content = await file.async("string");
      const json = parseJsonWithComments(content) as Record<string, unknown>;
      themes.push({
        name: (tc.label as string) || `${name} Theme`,
        uiTheme: (tc.uiTheme as string) || "vs-dark",
        json,
      });
    }

    if (themes.length === 0) throw new Error("No theme files could be extracted");

    return { themes, error: null };
  } catch (err) {
    return { themes: [], error: (err as Error).message };
  }
}
