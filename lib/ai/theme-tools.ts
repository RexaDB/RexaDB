import { z } from "zod";
import { createTool } from "@mastra/core/tools";

import { ok, fail } from "./ai-shared";
import { parseAppThemeJson, BUILTIN_APP_THEMES, type CustomAppTheme } from "@/lib/studio/app-themes";
import { parseThemeJson, createThemeId, type CustomEditorTheme } from "@/lib/studio/editor-themes";
import {
  getGlobalAppThemeSettings,
  saveGlobalAppThemeSettings,
  getGlobalEditorThemeSettings,
  saveGlobalEditorThemeSettings,
} from "@/lib/db/actions";

const APP_COLOR_KEYS_DESCRIPTION = [
  "YOU MUST INCLUDE ALL of the following CSS variables. Use this as a complete template:",
  "{",
  '  "--background": "<page bg>",',
  '  "--foreground": "<body text>",',
  '  "--card": "<card bg>",',
  '  "--card-foreground": "<card text>",',
  '  "--popover": "<popover bg>",',
  '  "--popover-foreground": "<popover text>",',
  '  "--primary": "<accent color>",',
  '  "--primary-foreground": "<text on primary>",',
  '  "--secondary": "<secondary bg>",',
  '  "--secondary-foreground": "<text on secondary>",',
  '  "--muted": "<muted bg>",',
  '  "--muted-foreground": "<muted text>",',
  '  "--accent": "<accent bg>",',
  '  "--accent-foreground": "<text on accent>",',
  '  "--destructive": "<danger color>",',
  '  "--border": "<dividers>",',
  '  "--input": "<input bg>",',
  '  "--ring": "<focus ring>",',
  '  "--chart-1": "<chart color>",',
  '  "--chart-2": "<chart color>",',
  '  "--chart-3": "<chart color>",',
  '  "--chart-4": "<chart color>",',
  '  "--chart-5": "<chart color>",',
  '  "--sidebar": "<sidebar bg>",',
  '  "--sidebar-foreground": "<sidebar text>",',
  '  "--sidebar-primary": "<sidebar accent>",',
  '  "--sidebar-primary-foreground": "<text>",',
  '  "--sidebar-accent": "<sidebar hover>",',
  '  "--sidebar-accent-foreground": "<text>",',
  '  "--sidebar-border": "<dividers>",',
  '  "--sidebar-ring": "<focus ring>",',
  '  "--studio-bg": "<editor bg>",',
  '  "--studio-border": "<editor borders>",',
  '  "--studio-header-bg": "<header bg>",',
  '  "--table-header-bg": "<header bg>",',
  '  "--studio-cell-text": "<cell text>",',
  '  "--studio-cell-muted": "<muted cell text>",',
  '  "--studio-tab-active": "<active tab>",',
  '  "--studio-tab-inactive": "<inactive tab>",',
  '  "--studio-row-hover": "<row hover>",',
  '  "--studio-selection": "<selection (use rgba)>",',
  '  "--studio-accent-purple": "<purple accent>"',
  "}",
  "FAILING TO INCLUDE ALL OF THESE WILL RESULT IN AN INCOMPLETE THEME.",
].join("\n");

function readArrayFromDb<T>(data: unknown, key: string, validator: (item: unknown) => item is T): T[] {
  if (!data || typeof data !== "object") return [];
  const raw = (data as Record<string, unknown>)[key];
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t: unknown): t is T => validator(t));
  } catch {
    return [];
  }
}

function readAppThemesFromDb(data: unknown): CustomAppTheme[] {
  return readArrayFromDb(data, "customAppThemes", (t): t is CustomAppTheme =>
    !!t && typeof (t as CustomAppTheme).id === "string" &&
    typeof (t as CustomAppTheme).name === "string" &&
    typeof (t as CustomAppTheme).colors === "object",
  );
}

function readEditorThemesFromDb(data: unknown): CustomEditorTheme[] {
  return readArrayFromDb(data, "customEditorThemes", (t): t is CustomEditorTheme =>
    !!t && typeof (t as CustomEditorTheme).id === "string" &&
    typeof (t as CustomEditorTheme).name === "string" &&
    typeof (t as CustomEditorTheme).themeJson === "string",
  );
}

function resolveExistingAppThemeIds(data: unknown): Set<string> {
  const ids = new Set<string>();
  for (const t of BUILTIN_APP_THEMES) ids.add(t.id);
  for (const t of readAppThemesFromDb(data)) ids.add(t.id);
  return ids;
}

function resolveExistingEditorThemeIds(data: unknown): Set<string> {
  return new Set(readEditorThemesFromDb(data).map((t) => t.id));
}

function createAppThemeTool() {
  return createTool({
    id: "create_app_theme",
    description:
      "Create and persist a custom app theme. Use this when the user asks you to create a new visual color theme for the app. " +
      "Generate appropriate colors based on the user's description, then call this tool to save them.",
    inputSchema: z.object({
      name: z.string().min(1).describe("Display name for the theme (e.g. 'Ocean Deep', 'Royal Purple')"),
      base: z.enum(["light", "dark"]).describe("Base color scheme"),
      colors: z.record(z.string(), z.string()).describe(APP_COLOR_KEYS_DESCRIPTION),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      data: z.any().nullable(),
      error: z.string().nullable(),
    }),
    execute: async ({ name, base, colors }) => {
      try {
        const validateJson = JSON.stringify({ name, base, colors });
        const validated = parseAppThemeJson(validateJson);
        if (validated.error || !validated.theme) {
          return fail(validated.error || "Invalid theme definition.");
        }

        const existingResult = await getGlobalAppThemeSettings();
        if (!existingResult.success) {
          return fail(existingResult.error || "Failed to read existing themes.");
        }

        const existingIds = resolveExistingAppThemeIds(existingResult.data);
        const id = createThemeId(name, existingIds);

        const theme: CustomAppTheme = {
          id,
          name: validated.theme.name,
          base: validated.theme.base,
          colors: validated.theme.colors,
        };

        const existingThemes = readAppThemesFromDb(existingResult.data);
        const updatedThemes = [theme, ...existingThemes];

        const saveResult = await saveGlobalAppThemeSettings({
          appThemeId: id,
          customAppThemes: JSON.stringify(updatedThemes),
        });

        if (!saveResult.success) {
          return fail(saveResult.error || "Failed to save theme.");
        }

        return ok({
          id: theme.id,
          name: theme.name,
          base: theme.base,
          colors: theme.colors,
          variableCount: Object.keys(theme.colors).length,
        });
      } catch (error) {
        return fail(error);
      }
    },
  });
}

function createEditorThemeTool() {
  return createTool({
    id: "create_editor_theme",
    description:
      "Create and persist a custom editor (Monaco/VS Code) theme. " +
      "Use when the user wants a custom syntax highlighting theme for the SQL editor.",
    inputSchema: z.object({
      name: z.string().min(1).describe("Display name for the editor theme"),
      themeJson: z.string().describe(
        "VS Code or Monaco theme JSON. Can include:\n" +
        '- "base": "vs" | "vs-dark" | "hc-black" | "hc-light"\n' +
        '- "colors": {} — editor color overrides (e.g. "editor.background", "editor.foreground")\n' +
        '- "tokenColors" (VS Code format) or "rules" (Monaco format) for syntax highlighting\n' +
        '- "inherit": boolean (default true)\n' +
        "Example: {\"base\":\"vs-dark\",\"colors\":{\"editor.background\":\"#1e1e2e\"},\"rules\":[{\"token\":\"comment\",\"foreground\":\"#6c7086\"}]}",
      ),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      data: z.any().nullable(),
      error: z.string().nullable(),
    }),
    execute: async ({ name, themeJson }) => {
      try {
        const parsed = parseThemeJson(themeJson);
        if (parsed.error) {
          return fail(parsed.error);
        }

        const existingResult = await getGlobalEditorThemeSettings();
        if (!existingResult.success) {
          return fail(existingResult.error || "Failed to read existing editor themes.");
        }

        const existingIds = resolveExistingEditorThemeIds(existingResult.data);
        const id = createThemeId(name || parsed.name || name, existingIds);

        const theme: CustomEditorTheme = {
          id,
          name: parsed.name || name,
          themeJson,
        };

        const existingThemes = readEditorThemesFromDb(existingResult.data);
        const updatedThemes = [theme, ...existingThemes];

        const saveResult = await saveGlobalEditorThemeSettings({
          editorThemeId: id,
          customEditorThemes: JSON.stringify(updatedThemes),
        });

        if (!saveResult.success) {
          return fail(saveResult.error || "Failed to save editor theme.");
        }

        return ok({
          id: theme.id,
          name: theme.name,
          base: parsed.theme?.base || "vs-dark",
          ruleCount: (parsed.theme?.rules || []).length,
          colorCount: Object.keys(parsed.theme?.colors || {}).length,
        });
      } catch (error) {
        return fail(error);
      }
    },
  });
}

function createListThemesTool() {
  return createTool({
    id: "list_themes",
    description: "List all available app themes and editor themes, both built-in and user-created.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      ok: z.boolean(),
      data: z.any().nullable(),
      error: z.string().nullable(),
    }),
    execute: async () => {
      try {
        const [appResult, editorResult] = await Promise.all([
          getGlobalAppThemeSettings(),
          getGlobalEditorThemeSettings(),
        ]);

        const builtinApps = BUILTIN_APP_THEMES.map((t) => ({
          id: t.id, name: t.name, base: t.base, builtin: true,
        }));
        const customApps = readAppThemesFromDb(appResult.data).map((t) => ({
          id: t.id, name: t.name, base: t.base, builtin: false,
        }));
        const customEditors = readEditorThemesFromDb(editorResult.data).map((t) => ({
          id: t.id, name: t.name, builtin: false,
        }));

        return ok({
          appThemeId: appResult.success ? (appResult.data as Record<string, unknown>)?.appThemeId || "zinc-dark-white" : "zinc-dark-white",
          editorThemeId: editorResult.success ? (editorResult.data as Record<string, unknown>)?.editorThemeId || "auto" : "auto",
          appThemes: [...builtinApps, ...customApps],
          editorThemes: customEditors,
        });
      } catch (error) {
        return fail(error);
      }
    },
  });
}

export function createThemeTools() {
  return {
    create_app_theme: createAppThemeTool(),
    create_editor_theme: createEditorThemeTool(),
    list_themes: createListThemesTool(),
  };
}
