"use client";

export function initMonaco() {
  if (typeof window === "undefined") return;

  window.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case "json":
          return new Worker(
            new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url)
          );
        case "css":
        case "scss":
        case "less":
          return new Worker(
            new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url)
          );
        case "html":
        case "handlebars":
        case "razor":
          return new Worker(
            new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url)
          );
        case "typescript":
        case "javascript":
          return new Worker(
            new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url)
          );
        default:
          return new Worker(
            new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url)
          );
      }
    },
  };

  void import("monaco-editor").then((monaco) => {
    void import("@monaco-editor/react").then(({ loader }) => {
      loader.config({ monaco });
    }).catch(() => {});
  }).catch(() => {});
}
