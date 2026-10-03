import { resolve } from "node:path";
import { type Config, loadConfig } from "../config.ts";
import { computeScenarioDiff } from "./diff.ts";
import { createRealAgents } from "./real-agents.ts";
import { type EvaluationItem, printTerminalReport, writeMarkdownReport } from "./reporter.ts";
import { runScenario } from "./runner.ts";
import { SCENARIOS } from "./scenarios.ts";

function parseArgs() {
  const args = process.argv.slice(2);

  // デフォルトは real（実 LLM / 実エージェント実行）。明示的に --mode=mock が指定された時だけ mock
  let mode: "mock" | "real" = "real";
  const modeArg = args.find((a) => a.startsWith("--mode="));
  if (modeArg) {
    const val = modeArg.split("=")[1];
    if (val === "real" || val === "mock") mode = val;
  }

  let scenarioId: string | undefined;
  const scenarioArg = args.find((a) => a.startsWith("--scenario="));
  if (scenarioArg) {
    scenarioId = scenarioArg.split("=")[1];
  }

  let outPath: string = resolve(process.cwd(), "eval-report.md");
  const outArg = args.find((a) => a.startsWith("--out="));
  if (outArg) {
    outPath = resolve(process.cwd(), outArg.split("=")[1]);
  }

  return { mode, scenarioId, outPath };
}

async function main() {
  const { mode, scenarioId, outPath } = parseArgs();

  console.log(`[Eval] Mode: ${mode}`);

  let config: Config | null = null;
  if (mode === "real") {
    try {
      config = loadConfig();
    } catch (err) {
      console.warn(
        `[WARN] Config load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.warn("[WARN] 実環境（.env）が利用できないため、mock モードにフォールバックする。");
    }
  }

  const effectiveMode = config && mode === "real" ? "real" : "mock";
  const realAgents = config && effectiveMode === "real" ? createRealAgents(config) : undefined;

  const targetScenarios = scenarioId
    ? SCENARIOS.filter((s) => s.id.includes(scenarioId) || s.name.includes(scenarioId))
    : SCENARIOS;

  if (targetScenarios.length === 0) {
    console.error(`エラー: 対象のシナリオが見つからない。(指定: ${scenarioId})`);
    process.exit(1);
  }

  console.log(
    `[Eval] 実行シナリオ数: ${targetScenarios.length} 件 (実行モード: ${effectiveMode})\n`,
  );

  const results: EvaluationItem[] = [];

  for (const scenario of targetScenarios) {
    process.stdout.write(`実行中: [${scenario.name}] ... `);
    const actual = await runScenario(scenario, {
      mode: effectiveMode,
      realAgents,
      timeoutMs: effectiveMode === "real" ? 60000 : 10000,
    });
    const diff = computeScenarioDiff(scenario, actual);

    console.log("完了");
    results.push({ scenario, actual, diff });
  }

  printTerminalReport(results);
  writeMarkdownReport(results, outPath);
}

main().catch((err) => {
  console.error("評価実行エラー:", err);
  process.exit(1);
});
