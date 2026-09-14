"use client";

import { useEffect, useMemo, useRef } from "react";

/**
 * Sandboxed webview host (VS Code-like `WebviewView` / `WebviewPanel`).
 * Renders extension HTML inside a sandboxed iframe with an `acquireRexaApi()`
 * bridge mirroring `acquireVsCodeApi()`.
 *
 * Theming: a base stylesheet maps the page to app system colors
 * (`Canvas`/`CanvasText`, `color-scheme: light dark`) so unstyled extension
 * HTML follows the app theme automatically, and the live theme
 * (`"light" | "dark"`) is pushed into the iframe on load and on every app
 * theme switch — readable via `acquireRexaApi().getState().theme` and via
 * `document.documentElement.dataset.rexaTheme` for CSS selectors.
 */

export type RexaWebviewTheme = "light" | "dark";

export function getAppTheme(): RexaWebviewTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

const THEME_STYLE = `<style>html{color-scheme:light dark}body{background:transparent;color:CanvasText;overflow-wrap:anywhere;word-break:break-all}body a{color:LinkText}img,table,pre,code{max-width:100%}</style>`;

function bridgeScript(viewId: string, extensionId: string | undefined, theme: RexaWebviewTheme): string {
  return `<script>
(function() {
  var listeners = new Set();
  function applyTheme(t) {
    try {
      document.documentElement.dataset.rexaTheme = t;
      document.documentElement.style.colorScheme = t;
      state.theme = t;
    } catch (e) {}
  }
  window.addEventListener("message", function(e) {
    var d = e.data;
    if (d && d.__rexaHost) {
      if (d.payload && d.payload.__rexaTheme) applyTheme(d.payload.__rexaTheme);
      else listeners.forEach(function(fn) { try { fn(d.payload); } catch (e) {} });
    }
  });
  var state = { viewId: ${JSON.stringify(viewId)}, extensionId: ${JSON.stringify(extensionId ?? null)}, theme: ${JSON.stringify(theme)} };
  applyTheme(state.theme);
  window.acquireRexaApi = function() {
    return {
      getState: function() { return state; },
      postMessage: function(payload) { parent.postMessage({ __rexaWebview: true, viewId: state.viewId, payload: payload }, "*"); },
      onDidReceiveMessage: function(fn) { listeners.add(fn); return { dispose: function() { listeners.delete(fn); } }; },
      setState: function(s) { Object.assign(state, s); },
    };
  };
})();
</script>`;
}

export function buildWebviewSrcDoc(
  html: string,
  opts: { viewId: string; extensionId?: string; theme?: RexaWebviewTheme },
): string {
  const theme = opts.theme ?? "dark";
  const injection = `${THEME_STYLE}${bridgeScript(opts.viewId, opts.extensionId, theme)}`;
  if (html.includes("</head>")) return html.replace("</head>", `${injection}</head>`);
  if (html.includes("</body>")) return html.replace("</body>", `${injection}</body>`);
  return `${html}${injection}`;
}

export function ExtensionWebview({
  viewId,
  html,
  extensionId,
  onMessage,
}: {
  viewId: string;
  html: string;
  extensionId?: string;
  onMessage?: (data: unknown) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const srcDoc = useMemo(
    () => buildWebviewSrcDoc(html, { viewId, extensionId, theme: getAppTheme() }),
    [html, viewId, extensionId],
  );

  // Push theme updates into the iframe whenever the app theme flips.
  useEffect(() => {
    const postTheme = () => {
      iframeRef.current?.contentWindow?.postMessage(
        { __rexaHost: true, payload: { __rexaTheme: getAppTheme() } },
        "*",
      );
    };
    postTheme();
    const observer = new MutationObserver(postTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [srcDoc]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.__rexaWebview && e.data?.viewId === viewId) onMessage?.(e.data.payload);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [viewId, onMessage]);

  return (
    <iframe
      ref={iframeRef}
      title={viewId}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      // block + min-w-0 + max-w-full: iframes are replaced elements with a
      // 300px default minimum width — without these guards the iframe itself
      // overflows narrow sidebars (and no inner text wrapping can fix that).
      className="block h-full max-w-full border-0 bg-transparent min-h-0 min-w-0 w-full"
    />
  );
}

/** Post a message into a webview (host -> webview). Kept as a helper so callers don't touch iframes. */
export function postToWebview(viewId: string, payload: unknown) {
  for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>(`iframe[title="${CSS.escape(viewId)}"]`))) {
    frame.contentWindow?.postMessage({ __rexaHost: true, payload }, "*");
  }
}
