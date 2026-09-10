import Editor, { loader } from "@monaco-editor/react";
import { monaco } from "./monaco";

loader.config({ monaco });

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
      theme={dark ? "vs-dark" : "vs"}
      value={value}
      onChange={onChange}
      options={{
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 12,
        wordWrap: "on",
        padding: { top: 12 },
      }}
    />
  );
}
