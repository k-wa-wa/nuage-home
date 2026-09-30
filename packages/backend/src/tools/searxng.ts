import { TUNING } from "../constants.ts";

/**
 * SearXNG 経由の Web 検索クライアント。
 * format=json で構造化された検索結果（タイトル・URL・スニペット）を取得する。
 */

export class SearxngError extends Error {}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearxngResultItem {
  title?: string;
  url?: string;
  content?: string;
  engine?: string;
}

interface SearxngResponse {
  query?: string;
  results?: SearxngResultItem[];
}

export function searxngSearchUrl(searxngUrl: string, query: string): string {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    language: "ja",
  });
  return `${searxngUrl.replace(/\/$/, "")}/search?${params.toString()}`;
}

export async function fetchViaSearxng(searxngUrl: string, query: string): Promise<SearchResult[]> {
  const url = searxngSearchUrl(searxngUrl, query);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TUNING.searxng.timeoutMs),
    });
  } catch (err) {
    throw new SearxngError(
      `SearXNG への接続に失敗した: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SearxngError(`SearXNG がエラーを返した（HTTP ${res.status}）: ${body.slice(0, 200)}`);
  }

  let data: SearxngResponse;
  try {
    data = (await res.json()) as SearxngResponse;
  } catch (err) {
    throw new SearxngError(
      `SearXNG のレスポンスを JSON としてパースできなかった: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return parseSearxngResults(data);
}

export function parseSearxngResults(data: SearxngResponse): SearchResult[] {
  if (!data.results || !Array.isArray(data.results)) {
    return [];
  }

  const results: SearchResult[] = [];
  for (const item of data.results) {
    if (!item.url || !item.title) continue;
    results.push({
      title: item.title.trim(),
      url: item.url.trim(),
      snippet: (item.content ?? "").trim(),
    });
  }
  return results;
}
