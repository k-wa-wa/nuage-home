import type { OpenAITool, SkillArgs, SkillDefinition } from "./types.ts"

/**
 * スキル（ツール）の登録・管理および実行ディスパッチを担うレジストリ
 */
export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map()

  /**
   * スキルを登録する
   */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill)
  }

  /**
   * 指定した名前のスキルを取得する
   */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name)
  }

  /**
   * 登録済みスキルの一覧を取得する
   */
  list(): SkillDefinition[] {
    return Array.from(this.skills.values())
  }

  /**
   * OpenAI API の tools 配列形式に変換する（コンテキスト削減のため最小限の定義）
   */
  toOpenAITools(): OpenAITool[] {
    return this.list().map((skill) => ({
      type: "function",
      function: {
        name: skill.name,
        description: skill.description,
        parameters: skill.parameters,
      },
    }))
  }

  /**
   * スキルを実行する。例外発生時もクラッシュさせずエラー文字列を返却する
   */
  async execute(name: string, args: SkillArgs): Promise<string> {
    const skill = this.skills.get(name)
    if (!skill) {
      return `エラー: スキル '${name}' は登録されていない。`
    }

    try {
      return await skill.execute(args)
    } catch (err) {
      return `エラー: スキル '${name}' の実行中に例外が発生した: ${String(err)}`
    }
  }

  /**
   * スキルの概要一覧テキストを生成する（プロンプト用）
   */
  describeSkills(): string {
    return this.list()
      .map((s) => `- ${s.name}: ${s.description}`)
      .join("\n")
  }
}
