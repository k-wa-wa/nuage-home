import type { SkillDefinition } from "../types.ts"

interface DdgTopic {
  Text?: string
  FirstURL?: string
}

interface DdgApiResponse {
  Heading?: string
  AbstractText?: string
  AbstractURL?: string
  RelatedTopics?: (DdgTopic | { Topics?: DdgTopic[] })[]
}

/**
 * Web検索スキル
 * デフォルトで DuckDuckGo Instant Answer API を使用し、キー不要で検索結果を取得する。
 * 将来 SEARXNG_URL や TAVILY_API_KEY が設定された場合はそちらを優先することも可能な構成とする。
 */
export const webSearchSkill: SkillDefinition = {
  name: "web_search",
  description: "Web上の情報や最新トピック、キーワードの意味を検索する",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "検索キーワードや質問文",
      },
    },
    required: ["query"],
  },
  execute: async (args) => {
    const query = typeof args.query === "string" ? args.query.trim() : ""
    if (!query) {
      return "検索キーワードが指定されていない。"
    }

    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&kl=jp-jp&no_html=1`
      const res = await fetch(url, {
        headers: {
          "User-Agent": "nuage-home/1.0",
        },
      })

      if (!res.ok) {
        return `検索リクエストに失敗した（HTTP ${res.status}）。`
      }

      const data = (await res.json()) as DdgApiResponse
      const results: string[] = []

      // 概要（Abstract）があれば追加
      if (data.AbstractText) {
        const title = data.Heading ? `【${data.Heading}】\n` : ""
        const link = data.AbstractURL ? `\n(出典: ${data.AbstractURL})` : ""
        results.push(`${title}${data.AbstractText}${link}`)
      }

      // 関連トピック（RelatedTopics）から抽出
      if (Array.isArray(data.RelatedTopics)) {
        for (const item of data.RelatedTopics) {
          if (results.length >= 4) break
          if ("Text" in item && item.Text) {
            results.push(`- ${item.Text} (${item.FirstURL ?? ""})`)
          } else if ("Topics" in item && Array.isArray(item.Topics)) {
            for (const subItem of item.Topics) {
              if (results.length >= 4) break
              if (subItem.Text) {
                results.push(`- ${subItem.Text} (${subItem.FirstURL ?? ""})`)
              }
            }
          }
        }
      }

      if (results.length === 0) {
        return `「${query}」に関する検索結果は見つからなかった。別のキーワードで試すか、Wikipedia検索を試してください。`
      }

      return results.join("\n\n")
    } catch (err) {
      return `検索実行中にエラーが発生した: ${String(err)}`
    }
  },
}
