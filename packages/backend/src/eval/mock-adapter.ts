import type { TaskOutput } from "@nuage-home/shared";
import { SCENARIOS } from "./scenarios.ts";
import type { E2EScenario } from "./types.ts";

/**
 * 専門エージェントのモックから、与えられた instruction に合致するシナリオを探す。
 */
export function findScenarioForApp(
  app: E2EScenario["expected"]["app"],
  instruction: string,
): E2EScenario | undefined {
  return SCENARIOS.find((s) => s.expected.app === app && s.mockMatch.test(instruction));
}

/**
 * モック Live から、ユーザー発話に合致するシナリオを探す。
 */
export function findScenarioForLive(text: string): E2EScenario | undefined {
  return SCENARIOS.find((s) => s.mockMatch.test(text));
}

/**
 * 専門エージェント用のモック実行関数を生成する。
 * シナリオにマッチした場合はそのシナリオの expected.output を返し、
 * 一致しなかった場合は fallback 関数を実行する。
 */
export function matchScenarioOutput(
  app: E2EScenario["expected"]["app"],
  instruction: string,
  fallback: (instruction: string) => TaskOutput,
): TaskOutput {
  const scenario = findScenarioForApp(app, instruction);
  if (scenario) {
    return structuredClone(scenario.expected.output);
  }
  return fallback(instruction);
}
