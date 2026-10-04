import type { TaskOutput } from "@nuage-home/shared";

/**
 * E2E テストシナリオの定義。
 * ユーザー発話から、Live 側のツール呼び出し、相槌、専門エージェントのタスク出力までを一気通貫で定義する。
 * サンドボックスのモックデータと評価用グラウンドトゥルースを兼ねる。
 */
export interface E2EScenario {
  /** シナリオの一意識別子（例: "research-kyoto"） */
  id: string;
  /** シナリオ名（例: "京都の紅葉調査"） */
  name: string;
  /** シナリオの説明やストーリー */
  description?: string;

  /** ユーザー入力 */
  input: {
    /** ユーザーの発話テキスト */
    userTurn: string;
  };

  /** モック照合用パターン（モック Live やエージェントが判定に使う） */
  mockMatch: RegExp;

  /** 想定される動作と出力（Expected） */
  expected: {
    /** Live が呼び出すべきツール名 */
    tool: "add_task";
    /** 対象エージェント名 */
    app: "research" | "smart_home" | "autopilot";
    /** Live の初期相槌（目安・トーン） */
    ackSpeech: string;
    /** 専門エージェントの完了出力 */
    output: TaskOutput;
  };

  /** LLM as a Judge の評価基準（自然言語の箇条書きや文章） */
  criteria: string | string[];
}

/** 実際の E2E 実行結果 */
export interface ActualExecution {
  /** 呼び出されたツール */
  toolCall?: {
    name: string;
    app?: string;
    instruction?: string;
  };
  /** Live の相槌 */
  ackSpeech?: string;
  /** タスク完了時の出力 */
  output?: TaskOutput;
  /** エラーが発生した場合はそのメッセージ */
  error?: string;
}

/** 差分結果 */
export interface ScenarioDiff {
  scenarioId: string;
  scenarioName: string;
  toolMatched: boolean;
  ackSpeechDiff?: {
    expected: string;
    actual: string;
  };
  speechDiff?: {
    expected: string;
    actual: string;
  };
  reportDiff?: {
    expectedTitle?: string;
    actualTitle?: string;
    markdownDiff?: string;
  };
}
