import Editor, { loader } from "@monaco-editor/react";
import { monaco } from "./monaco";

loader.config({ monaco });

monaco.editor.defineTheme("jwb-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "string.key.json", foreground: "d4d4d8" },
    { token: "string.value.json", foreground: "4ade80" },
    { token: "string", foreground: "4ade80" },
    { token: "number", foreground: "fbbf24" },
    { token: "keyword.json", foreground: "f87171" },
  ],
  colors: {
    "editor.background": "#121214",
    "editor.foreground": "#fafafa",
    "editorLineNumber.foreground": "#3f3f46",
    "editorLineNumber.activeForeground": "#a1a1aa",
    "editor.selectionBackground": "#f5822033",
    "editorCursor.foreground": "#f58220",
  },
});
monaco.editor.defineTheme("jwb-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "string.key.json", foreground: "3f3f46" },
    { token: "string.value.json", foreground: "16a34a" },
    { token: "string", foreground: "16a34a" },
    { token: "number", foreground: "d97706" },
    { token: "keyword.json", foreground: "dc2626" },
  ],
  colors: {
    "editor.background": "#f4f4f5",
    "editor.foreground": "#09090b",
    "editorCursor.foreground": "#ea580c",
  },
});

export function MonacoRawEditor({
  value,
  dark,
  onChange,
}: {
  value: string;
  dark: boolean;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Editor
      height="560px"
      defaultLanguage="json"
      theme={dark ? "jwb-dark" : "jwb-light"}
      value={value}
      onChange={onChange}
      options={{
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily:
          "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
        wordWrap: "on",
        padding: { top: 12 },
      }}
    />
  );
}
