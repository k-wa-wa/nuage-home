import { describe, expect, it } from "vitest";
import { parseSearxngResults, searxngSearchUrl } from "./searxng.ts";

describe("searxngSearchUrl", () => {
  it("正しい検索 URL を組み立てる", () => {
    const url = searxngSearchUrl("http://searxng.example:8080", "京都 紅葉");
    expect(url).toContain("http://searxng.example:8080/search?");
    expect(url).toContain("q=%E4%BA%AC%E9%83%BD+%E7%B4%85%E8%91%89");
    expect(url).toContain("format=json");
    expect(url).toContain("language=ja");
  });
});

describe("parseSearxngResults", () => {
  it("SearXNG の JSON レスポンスから結果を取り出す", () => {
    const json = {
      query: "京都 紅葉",
      results: [
        {
          title: "京都の紅葉名所ガイド",
          url: "https://example.com/kyoto",
          content: "清水寺や嵐山などの見頃情報をお届けします。",
          engine: "duckduckgo",
        },
        {
          title: "京都紅葉ツアー2026",
          url: "https://example.com/tour",
          content: "秋の特別拝観とライトアップ。",
          engine: "brave",
        },
        {
          title: "無効な結果",
          url: "",
          content: "URL がない",
        },
      ],
    };

    const results = parseSearxngResults(json);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "京都の紅葉名所ガイド",
      url: "https://example.com/kyoto",
      snippet: "清水寺や嵐山などの見頃情報をお届けします。",
    });
    expect(results[1]).toEqual({
      title: "京都紅葉ツアー2026",
      url: "https://example.com/tour",
      snippet: "秋の特別拝観とライトアップ。",
    });
  });

  it("空の結果を安全に扱う", () => {
    expect(parseSearxngResults({})).toEqual([]);
    expect(parseSearxngResults({ results: [] })).toEqual([]);
  });
});
