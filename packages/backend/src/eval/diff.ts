import type { ActualExecution, E2EScenario, ScenarioDiff } from "./types.ts";

/**
 * 簡易 Unified Diff を生成する。
 * 行単位で比較し、差分（-期待値, +実際）を出力する。
 */
export function createLineDiff(expected: string, actual: string): string {
  if (expected === actual) {
    return "  (完全一致)";
  }

  const expLines = expected.split("\n");
  const actLines = actual.split("\n");
  const lines: string[] = [];

  // 簡易行比較（LCS を用いた最小限の差分検出）
  const max = Math.max(expLines.length, actLines.length);
  for (let i = 0; i < max; i++) {
    const exp = expLines[i];
    const act = actLines[i];
    if (exp === act) {
      if (exp !== undefined) lines.push(`  ${exp}`);
    } else {
      if (exp !== undefined) lines.push(`- ${exp}`);
      if (act !== undefined) lines.push(`+ ${act}`);
    }
  }

  return lines.join("\n");
}

/**
 * 想定出力（Expected）と実出力（Actual）を比較し、ScenarioDiff を生成する。
 */
export function computeScenarioDiff(scenario: E2EScenario, actual: ActualExecution): ScenarioDiff {
  const toolMatched =
    actual.toolCall?.name === scenario.expected.tool &&
    actual.toolCall?.app === scenario.expected.app;

  const diff: ScenarioDiff = {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    toolMatched,
  };

  // 相槌の差分
  if (scenario.expected.ackSpeech || actual.ackSpeech) {
    diff.ackSpeechDiff = {
      expected: scenario.expected.ackSpeech,
      actual: actual.ackSpeech ?? "(なし)",
    };
  }

  // 音声メッセージ（speech）の差分
  if (scenario.expected.output.speech || actual.output?.speech) {
    diff.speechDiff = {
      expected: scenario.expected.output.speech,
      actual: actual.output?.speech ?? "(なし)",
    };
  }

  // レポートの差分
  const expReport = scenario.expected.output.report;
  const actReport = actual.output?.report;
  if (expReport || actReport) {
    diff.reportDiff = {
      expectedTitle: expReport?.title,
      actualTitle: actReport?.title,
      markdownDiff: createLineDiff(
        expReport?.markdown ?? "(レポートなし)",
        actReport?.markdown ?? "(レポートなし)",
      ),
    };
  }

  return diff;
}
