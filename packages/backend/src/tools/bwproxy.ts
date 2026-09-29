import { TUNING } from "../constants.ts"

/**
 * bare-web-proxy（bwproxy）経由のページ取得。
 * プログラムモード（X-Program-Mode: true）で、ナビゲーションや装飾を落とした軽量 HTML を受け取る。
 * 検索エンジンは Yahoo! JAPAN を使う（ブラウザを名乗らなくても安定して結果が取れる）。
 * bwproxy は呼び出し元の User-Agent をヘッドレス Chrome にそのまま使わせるため、bwproxy の `q=`（DuckDuckGo）は
 * ブラウザ以外の User-Agent ではボット判定で弾かれる。Brave Search は連続アクセスで弾かれた（2026-09-29 の実測）。
 */

export class BwproxyError extends Error {}

export async function fetchViaBwproxy(bwproxyUrl: string, targetUrl: string): Promise<string> {
  const res = await fetch(`${bwproxyUrl}/proxy?url=${encodeURIComponent(targetUrl)}`, {
    headers: { "X-Program-Mode": "true" },
    signal: AbortSignal.timeout(TUNING.bwproxy.timeoutMs),
  })
  if (!res.ok) {
    // 失敗時は { error, reason } の JSON が返る
    const body = await res.text()
    throw new BwproxyError(`bwproxy が失敗した（HTTP ${res.status}）: ${body.slice(0, 200)}`)
  }
  return res.text()
}

export function yahooSearchUrl(query: string): string {
  return `https://search.yahoo.co.jp/search?p=${encodeURIComponent(query)}`
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/** Yahoo! JAPAN の検索結果ページ（bwproxy のプログラムモード）から結果を取り出す */
export function parseYahooResults(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const item = /<li><a href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a><div>([\s\S]*?)<\/div>/g
  for (const m of html.matchAll(item)) {
    const url = decodeEntities(m[1])
    // Yahoo 自身のヘルプ等は結果ではない
    if (/^https?:\/\/[^/]*yahoo(-net)?\.(co\.jp|jp|com)\//.test(url)) continue
    results.push({ title: htmlToText(m[2]), url, snippet: htmlToText(m[3]) })
  }
  return results
}

/** HTML を LLM に渡すためのプレーンテキストにする */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
      // 強調などの行内要素は、日本語の途中に空白が入らないよう詰めて外す
      .replace(/<\/?(b|strong|em|i|u|mark|small|span|a|code|sup|sub)\b[^>]*>/gi, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
}
