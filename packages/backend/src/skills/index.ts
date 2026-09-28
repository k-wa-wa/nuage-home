import { SkillRegistry } from "./registry.ts"
import { webSearchSkill } from "./builtin/web-search.ts"
import { weatherSkill } from "./builtin/weather.ts"
import { wikipediaSkill } from "./builtin/wikipedia.ts"

export * from "./types.ts"
export * from "./registry.ts"

/**
 * デフォルトのスキルレジストリを作成・初期化する
 */
export function createDefaultSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry()
  registry.register(webSearchSkill)
  registry.register(weatherSkill)
  registry.register(wikipediaSkill)
  return registry
}
