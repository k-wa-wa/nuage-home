export interface SkillParameterProperty {
  type: "string" | "number" | "boolean"
  description: string
  enum?: string[]
}

export interface SkillParameters {
  type: "object"
  properties: Record<string, SkillParameterProperty>
  required?: string[]
}

/** LLM が生成したツール引数。値の型は保証されないため各スキルで検証する */
export type SkillArgs = Record<string, unknown>

export interface SkillDefinition {
  name: string
  description: string
  parameters: SkillParameters
  execute: (args: SkillArgs) => Promise<string>
}

export interface OpenAITool {
  type: "function"
  function: {
    name: string
    description: string
    parameters: SkillParameters
  }
}
