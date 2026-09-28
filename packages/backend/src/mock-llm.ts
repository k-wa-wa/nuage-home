import type { LlmMessage, LlmResponse } from "./llm-client.ts"

const MOCK_REPLIES = [
  "了解、今日の予定を確認したよ。特に変更はなさそう。",
  "そのタスクは明日の朝までに終わらせておくね。",
  "今のところ異常は見つからなかったよ。",
  "うーん、ちょっと確認するね。少し待ってて。",
  "はい、設定を反映したよ。他に何かある？",
]

function toolCall(name: string, args: Record<string, string>): LlmResponse {
  return {
    content: null,
    tool_calls: [{ id: `call_${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  }
}

/**
 * 開発・UI検証用のモックLLM
 * 最後のメッセージに応じて適切なツールの呼び出し（tool_calls）または回答テキストを擬似生成する。
 */
export async function mockChat(messages: LlmMessage[]): Promise<LlmResponse> {
  const delayMs = 300 + Math.random() * 400
  await new Promise((resolve) => setTimeout(resolve, delayMs))

  const lastMessage = messages[messages.length - 1]

  // 直前がツール実行結果（role: "tool"）の場合、結果を受けた回答を返す
  if (lastMessage?.role === "tool") {
    return {
      content: `確認したよ！\n${lastMessage.content}`,
    }
  }

  // 直前のユーザー入力を確認
  const lastUserText = messages.slice().reverse().find((m) => m.role === "user")?.content ?? ""

  // モックでのツール呼び出しトリガー判定
  if (lastUserText.includes("天気")) {
    const locMatch = lastUserText.match(/(東京|大阪|札幌|福岡|京都|横浜|名古屋|仙台|広島|那覇)/)
    const location = locMatch ? locMatch[1] : "東京"
    return toolCall("weather", { location })
  }

  if (lastUserText.includes("検索") || lastUserText.includes("調べて")) {
    const query = lastUserText.replace(/(検索|調べて|について|を)/g, "").trim() || "ニュース"
    return toolCall("web_search", { query })
  }

  if (lastUserText.includes("とは") || lastUserText.includes("って何")) {
    const keyword = lastUserText.replace(/(とは|って何|？|\?)/g, "").trim()
    if (keyword) {
      return toolCall("wikipedia", { keyword })
    }
  }

  // 通常のモック返答
  return {
    content: MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)],
  }
}
