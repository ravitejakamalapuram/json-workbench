import { stringifyJsonValue } from "./input";
import type { PipelineDefinition, PipelineStepDefinition } from "./types";

export type CodegenTarget =
  "jsonata" | "jq" | "javascript" | "typescript" | "python" | "sql";

function json(value: unknown): string {
  if (value === undefined) return "null";
  return stringifyJsonValue(value as never, true);
}

function field(
  config: Record<string, unknown>,
  name: string,
  fallback = "value",
): string {
  return typeof config[name] === "string" ? String(config[name]) : fallback;
}

function jqStep(step: PipelineStepDefinition): string {
  const config = step.config as Record<string, unknown>;
  switch (step.type) {
    case "filter":
      return `map(select(.${field(config, "field")} == ${json(config.equals)}))`;
    case "pick":
      return `.[] | {${Array.isArray(config.fields) ? config.fields.map((item) => `"${String(item)}": .${String(item)}`).join(", ") : ""}}`;
    case "rename":
      return `map(.${field(config, "from")} as $value | . + {"${field(config, "to")}": $value} | del(.${field(config, "from")}))`;
    case "remove":
      return Array.isArray(config.fields)
        ? `map(del(${config.fields.map((item) => `.${String(item)}`).join(", ")}))`
        : ".";
    case "sort":
      return `sort_by(.${field(config, "key")})${config.direction === "desc" ? " | reverse" : ""}`;
    case "jsonata":
    case "jq":
      return field(config, "expression", ".");
    default:
      return `# ${step.type} ${json(config)}`;
  }
}

function jsonataStep(step: PipelineStepDefinition): string {
  const config = step.config as Record<string, unknown>;
  if (step.type === "jsonata") return field(config, "expression", "$ ");
  if (step.type === "filter")
    return `$[${field(config, "field")} = ${json(config.equals)}]`;
  if (step.type === "sort")
    return `$sort($, function($a, $b) { $a.${field(config, "key")} < $b.${field(config, "key")} })`;
  return `/* ${step.type}: ${json(config)} */ $`;
}

export function generatePipelineCode(
  definition: PipelineDefinition,
  target: CodegenTarget,
): string {
  const enabled = definition.steps.filter((step) => step.enabled);
  if (target === "jsonata") return enabled.map(jsonataStep).join("\n");
  if (target === "jq") return enabled.map(jqStep).join(" | ");
  if (target === "sql") {
    const filters = enabled
      .filter((step) => step.type === "filter")
      .map(
        (step) =>
          `${field(step.config as Record<string, unknown>, "field")} = ${json((step.config as Record<string, unknown>).equals)}`,
      );
    return `SELECT * FROM input${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""};`;
  }
  if (target === "python") {
    return `import json\n\nwith open("input.json", encoding="utf-8") as source:\n    data = json.load(source)\n\nresult = data\n# Pipeline: ${enabled.map((step) => step.type).join(" -> ")}\nprint(json.dumps(result, ensure_ascii=False, indent=2))`;
  }
  const type = target === "typescript" ? ": unknown" : "";
  return `const input${type} = await readInput();\nlet result = input;\n// Pipeline: ${enabled.map((step) => step.type).join(" -> ")}\n${enabled.map((step) => `// ${step.type}\n// ${json(step.config)}`).join("\n")}\nawait writeOutput(result);`;
}
