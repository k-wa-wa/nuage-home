/**
 * 裏で仕事を引き受ける専門エージェント（調査エージェント、将来の autopilot chat など）。
 * 会話層からは `add_task` ツールから依頼され、タスクとして裏で実行される。
 */
export interface AppAgent {
  name: string;
  /** Live に見せる一行説明 */
  description: string;
  /** 仕事を実行し、結果の全文を返す。失敗したら例外を投げる */
  ask(instruction: string, signal: AbortSignal): Promise<string>;
}
