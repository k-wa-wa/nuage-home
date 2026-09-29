export interface ToolParameterProperty {
  type: "string" | "number" | "boolean";
  description: string;
  enum?: string[];
}

export interface ToolParameters {
  type: "object";
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

/** LLM が生成したツール引数。値の型は保証されないため各ツールで検証する */
export type ToolArgs = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (args: ToolArgs) => Promise<string>;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParameters;
  };
}
