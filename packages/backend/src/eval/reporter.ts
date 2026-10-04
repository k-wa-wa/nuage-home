import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ActualExecution, E2EScenario, ScenarioDiff } from "./types.ts";

export interface EvaluationItem {
  scenario: E2EScenario;
  actual: ActualExecution;
  diff: ScenarioDiff;
}

// ANSI カラーコード
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/**
 * ターミナルへ差分と結果を出力する。
 */
export function printTerminalReport(items: EvaluationItem[]): void {
  console.log(`\n${BOLD}========================================${RESET}`);
  console.log(`${BOLD}  LLM E2E Evaluation Diff Report  ${RESET}`);
  console.log(`${BOLD}========================================${RESET}\n`);

  for (const { scenario, actual, diff } of items) {
    console.log(`${CYAN}${BOLD}[Scenario] ${scenario.name} (${scenario.id})${RESET}`);
    console.log(`  User: "${scenario.input.userTurn}"`);

    // ツール呼び出し
    const toolStatus = diff.toolMatched
      ? `${GREEN}MATCH (app: ${scenario.expected.app})${RESET}`
      : `${RED}MISMATCH (exp: ${scenario.expected.app}, act: ${actual.toolCall?.app ?? "none"})${RESET}`;
    console.log(`  Tool: ${scenario.expected.tool} -> ${toolStatus}`);

    // 相槌
    if (diff.ackSpeechDiff) {
      const match =
        diff.ackSpeechDiff.expected === diff.ackSpeechDiff.actual
          ? `${GREEN}MATCH${RESET}`
          : `${YELLOW}DIFF${RESET}`;
      console.log(`  Ack:  "${diff.ackSpeechDiff.actual}" (${match})`);
    }

    // 音声メッセージ差分
    if (diff.speechDiff) {
      console.log(`\n  ${BOLD}[Speech Diff]${RESET}`);
      console.log(`  ${RED}- ${diff.speechDiff.expected}${RESET}`);
      console.log(`  ${GREEN}+ ${diff.speechDiff.actual}${RESET}`);
    }

    // レポート差分
    if (diff.reportDiff?.markdownDiff) {
      console.log(`\n  ${BOLD}[Report Diff]${RESET}`);
      const snippet = diff.reportDiff.markdownDiff.split("\n").slice(0, 10).join("\n  ");
      console.log(`  ${snippet}`);
      if (diff.reportDiff.markdownDiff.split("\n").length > 10) {
        console.log(`  ... (他は eval-report.md を参照)`);
      }
    }

    console.log(`\n----------------------------------------\n`);
  }
}

/**
 * Markdown レポート（eval-report.md）を生成する。
 * Antigravity や Claude Code 等の外部エージェントが評価基準と差分を直接精査できるよう構成する。
 */
export function writeMarkdownReport(
  items: EvaluationItem[],
  outputPath = resolve(process.cwd(), "eval-report.md"),
): void {
  const timestamp = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  const lines: string[] = [
    `# E2E LLM Evaluation Diff Report`,
    `実行日時: ${timestamp}`,
    "",
    "| シナリオ | ユーザー発話 | ツール判定 | 音声差分 | レポート |",
    "| :--- | :--- | :---: | :---: | :---: |",
  ];

  for (const { scenario, diff } of items) {
    const toolIcon = diff.toolMatched ? "✅ 一致" : "❌ 不一致";
    const speechDiffIcon =
      diff.speechDiff?.expected === diff.speechDiff?.actual ? "✅ 一致" : "⚠️ 差分あり";
    const reportIcon = diff.reportDiff ? "あり" : "なし";
    lines.push(
      `| ${scenario.name} | \`${scenario.input.userTurn}\` | ${toolIcon} | ${speechDiffIcon} | ${reportIcon} |`,
    );
  }

  lines.push("", "---", "");

  for (const { scenario, actual, diff } of items) {
    lines.push(`### 🔍 ${scenario.name} (\`${scenario.id}\`)`);
    lines.push(`- **ユーザー入力**: \`${scenario.input.userTurn}\``);
    lines.push(
      `- **ツール呼び出し**: \`${scenario.expected.tool}\` (\`app: ${actual.toolCall?.app ?? "なし"}\`) - ${diff.toolMatched ? "✅ 一致" : "❌ 不一致"}`,
    );

    // 評価基準
    lines.push("");
    lines.push(`#### 📋 評価基準 (Criteria)`);
    if (Array.isArray(scenario.criteria)) {
      for (const c of scenario.criteria) {
        lines.push(`- ${c}`);
      }
    } else {
      lines.push(scenario.criteria);
    }
    lines.push("");

    lines.push("<details open>");
    lines.push("<summary>想定出力 (Expected) vs 実際の出力 (Actual)</summary>");
    lines.push("");

    if (diff.ackSpeechDiff) {
      lines.push("##### 相槌 (Ack Speech)");
      lines.push(`- **想定**: ${diff.ackSpeechDiff.expected}`);
      lines.push(`- **実際**: ${diff.ackSpeechDiff.actual}`);
      lines.push("");
    }

    if (diff.speechDiff) {
      lines.push("##### 音声メッセージ (speech)");
      lines.push(`- **想定 (Expected)**: ${diff.speechDiff.expected}`);
      lines.push(`- **実際 (Actual)**: ${diff.speechDiff.actual}`);
      lines.push("");
    }

    if (diff.reportDiff) {
      lines.push("##### レポート (report) Diff");
      lines.push("```diff");
      lines.push(diff.reportDiff.markdownDiff ?? "(差分なし)");
      lines.push("```");
      lines.push("");
    }

    lines.push("</details>");
    lines.push("", "---", "");
  }

  writeFileSync(outputPath, lines.join("\n"), "utf8");
  console.log(`Markdown レポートを出力した: ${outputPath}\n`);
}
