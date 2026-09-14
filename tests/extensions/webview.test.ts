import test from "node:test";
import assert from "node:assert/strict";
import { buildWebviewSrcDoc } from "../../components/studio/extension-webview";

test("buildWebviewSrcDoc injects theme style + bridge", () => {
  const src = buildWebviewSrcDoc("<html><head></head><body><h1>Hi</h1></body></html>", {
    viewId: "demo.view",
    extensionId: "demo.ext",
    theme: "light",
  });
  assert.ok(src.includes("<h1>Hi</h1>"), "original html preserved");
  assert.ok(src.includes("color-scheme:light dark"), "theme-following base style injected");
  assert.ok(src.includes("overflow-wrap:anywhere"), "long words wrap instead of overflowing the sidebar");
  assert.ok(src.includes("word-break:break-all"), "break-all fallback for engines ignoring anywhere (e.g. WKWebView)");
  assert.ok(src.includes("acquireRexaApi"), "vscode-like bridge injected");
  assert.ok(src.includes("rexaTheme"), "theme bridge present");
  assert.ok(src.includes('"light"'), "initial theme embedded");
});

test("buildWebviewSrcDoc works without head/body tags", () => {
  const src = buildWebviewSrcDoc("<h1>bare</h1>", { viewId: "v" });
  assert.ok(src.includes("<h1>bare</h1>"));
  assert.ok(src.includes("acquireRexaApi"));
});
