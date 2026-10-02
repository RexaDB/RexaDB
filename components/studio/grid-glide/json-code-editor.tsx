"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { useGlobalAppTheme } from "@/hooks/use-global-app-theme";
import { useTheme } from "@/components/providers/theme-provider";
import { registerCustomMonacoThemes } from "@/lib/studio/editor-themes";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export function formatJsonText(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return JSON.stringify(text, null, 2);
  }
}

export function JsonCodeEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { appEditorTheme } = useGlobalAppTheme();
  const { resolvedTheme } = useTheme();
  const monacoRef = useRef<any>(null);

  useEffect(() => {
    if (monacoRef.current && appEditorTheme) {
      registerCustomMonacoThemes(monacoRef.current, [appEditorTheme]);
    }
  }, [appEditorTheme]);

  return (
    <div className="min-h-0 flex-1">
      <MonacoEditor
        height="100%"
        language="json"
        theme={appEditorTheme?.id ?? (resolvedTheme === "light" ? "vs" : "vs-dark")}
        value={value}
        onChange={(next) => onChange(next ?? "")}
        beforeMount={(monaco) => {
          monacoRef.current = monaco;
          if (appEditorTheme) registerCustomMonacoThemes(monaco, [appEditorTheme]);
        }}
        onMount={(editor, monaco) => {
          monacoRef.current = monaco;
          if (appEditorTheme) registerCustomMonacoThemes(monaco, [appEditorTheme]);
          editor.focus();
        }}
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 13,
          tabSize: 2,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          formatOnPaste: true,
          formatOnType: true,
          padding: { top: 16, bottom: 16 },
        }}
      />
    </div>
  );
}
