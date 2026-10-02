import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_APP_THEMES } from "@/lib/studio/app-themes";
import { buildMonacoThemeFromAppTheme, getStudioDarkTheme } from "@/lib/studio/editor-themes";
import { darkMonacoSelection } from "@/lib/studio/monaco-selection";

test("dark Monaco selection matches the high-contrast browser selection mix", () => {
  assert.deepEqual(darkMonacoSelection("#2870bd", "#e2e2e2", "#111113"), {
    background: "#7ca3ce",
    foreground: "#111113",
  });
});

test("dark app themes give Monaco an active selection distinct from subtle matches", () => {
  for (const theme of BUILTIN_APP_THEMES.filter((item) => item.base === "dark")) {
    const colors = buildMonacoThemeFromAppTheme(theme).colors!;
    assert.notEqual(colors["editor.selectionBackground"], colors["editor.selectionHighlightBackground"]);
    assert.equal(colors["editor.selectionForeground"], theme.colors["--background"]);
  }
});

test("studio-dark Monaco theme uses a distinct active selection", () => {
  const colors = getStudioDarkTheme().colors!;
  assert.match(colors["editor.selectionBackground"], /^#[\da-f]{6}$/i);
  assert.notEqual(colors["editor.selectionBackground"], colors["editor.selectionHighlightBackground"]);
  assert.equal(colors["editor.selectionForeground"], "#111113");
});
