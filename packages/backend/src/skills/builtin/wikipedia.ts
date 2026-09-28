import type { SkillDefinition } from "../types.ts"

interface WikipediaSummaryResponse {
  title?: string
  description?: string
  extract?: string
  content_urls?: {
    desktop?: {
      page?: string
    }
  }
}

const REQUEST_HEADERS = { "User-Agent": "nuage-home/1.0 (home-assistant)" }

/**
 * Wikipedia要約検索スキル
 * Wikipedia REST API を利用し、用語・人物・出来事・概念などの解説要約を高速に取得する。
 */
export const wikipediaSkill: SkillDefinition = {
  name: "wikipedia",
  description: "Wikipedia日本語版から人物・用語・歴史・概念などの概要や解説を取得する",
  parameters: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "解説を調べたいキーワードや用語（例: '相対性理論', '夏目漱石'）",
      },
    },
    required: ["keyword"],
  },
  execute: async (args) => {
    const keyword = typeof args.keyword === "string" ? args.keyword.trim() : ""
    if (!keyword) {
      return "検索キーワードが指定されていない。"
    }

    try {
      const summaryUrl = `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(keyword)}`
      const res = await fetch(summaryUrl, { headers: REQUEST_HEADERS })

      if (res.status === 404) {
        // 見つからない場合は検索候補を探す
        const searchUrl = `https://ja.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(keyword)}&limit=3&namespace=0&format=json`
        const searchRes = await fetch(searchUrl, { headers: REQUEST_HEADERS })
        if (searchRes.ok) {
          const searchData = (await searchRes.json()) as [string, string[], string[], string[]]
          const suggestions = searchData[1]
          if (suggestions && suggestions.length > 0) {
            return `「${keyword}」に完全一致する記事は見つからなかった。候補: ${suggestions.join("、")}`
          }
        }
        return `「${keyword}」に関するWikipediaの記事は見つからなかった。`
      }

      if (!res.ok) {
        return `Wikipediaの取得に失敗した（HTTP ${res.status}）。`
      }

      const data = (await res.json()) as WikipediaSummaryResponse
      const title = data.title ?? keyword
      const desc = data.description ? ` (${data.description})` : ""
      const extract = data.extract ?? "要約情報がありません。"
      const url = data.content_urls?.desktop?.page ? `\n(出典: ${data.content_urls.desktop.page})` : ""

      return `【${title}${desc}】\n${extract}${url}`
    } catch (err) {
      return `Wikipedia検索中にエラーが発生した: ${String(err)}`
    }
  },
}
