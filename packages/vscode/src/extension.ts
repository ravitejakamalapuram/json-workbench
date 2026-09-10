import * as vscode from "vscode";
import {
  createDefaultStepFactory,
  parseJsonValue,
  parsePipeline,
  runPipeline,
  stringifyJsonValue,
} from "@json-workbench/core";

export function activate(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    "jsonWorkbench.runPipeline",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showErrorMessage("Open a JSON document first.");
        return;
      }
      const pipelineText = await vscode.window.showInputBox({
        prompt: "Paste a JSON Workbench pipeline definition",
        placeHolder: '{"version":1,"steps":[]}',
      });
      if (pipelineText === undefined) return;
      try {
        const result = await runPipeline(
          parseJsonValue(editor.document.getText()),
          parsePipeline(pipelineText),
          createDefaultStepFactory(),
        );
        const document = await vscode.workspace.openTextDocument({
          language: "json",
          content: stringifyJsonValue(result, true),
        });
        await vscode.window.showTextDocument(document, { preview: false });
      } catch (error) {
        void vscode.window.showErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  );
  context.subscriptions.push(command);
}

export function deactivate(): void {
  // No persistent state or remote service is used by this integration.
}
