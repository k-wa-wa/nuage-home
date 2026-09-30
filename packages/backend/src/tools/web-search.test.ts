import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebSearchTool } from "./web-search.ts";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: string, status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(body, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("web_search", () => {
  it("SearXNG の検索結果を取得し、番号付きで返す", async () => {
    const json = JSON.stringify({
      query: "京都 紅葉",
      results: [
        {
          title: "京都紅葉名所2026",
          url: "https://example.com/kyoto",
          content: "清水寺や嵐山などの見頃情報。",
        },
        {
          title: "秋の京都観光ガイド",
          url: "https://example.com/autumn",
          content: "おすすめ散策コース。",
        },
      ],
    });

    const fetchMock = stubFetch(json);
    const out = await createWebSearchTool("http://searxng.example:8080").execute({
      query: "京都 紅葉",
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("http://searxng.example:8080/search?");
    expect(String(fetchMock.mock.calls[0][0])).toContain("format=json");
    expect(out).toContain("1. 京都紅葉名所2026");
    expect(out).toContain("   https://example.com/kyoto");
    expect(out).toContain("   清水寺や嵐山などの見頃情報。");
    expect(out).toContain("2. 秋の京都観光ガイド");
  });

  it("結果が無ければ、別のキーワードを促す", async () => {
    stubFetch(JSON.stringify({ query: "zzz", results: [] }));
    const out = await createWebSearchTool("http://searxng.example:8080").execute({
      query: "zzz",
    });
    expect(out).toContain("見つからなかった");
    expect(out).toContain("別のキーワード");
  });

  it("キーワードが空なら警告メッセージを返す", async () => {
    const out = await createWebSearchTool("http://searxng.example:8080").execute({
      query: "   ",
    });
    expect(out).toContain("指定されていない");
  });

  it("SearXNG 接続エラー時は安全にメッセージを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Connection refused");
      }),
    );
    const out = await createWebSearchTool("http://searxng.example:8080").execute({
      query: "京都",
    });
    expect(out).toContain("検索中にエラーが発生した");
    expect(out).toContain("Connection refused");
  });
});
