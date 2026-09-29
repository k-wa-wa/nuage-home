import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TUNING } from "../constants.ts";
import { BwproxyError, fetchViaBwproxy, htmlToText, parseYahooResults } from "./bwproxy.ts";
import { createFetchPageTool } from "./fetch-page.ts";
import { createWebSearchTool } from "./web-search.ts";

/** 2026-09-29 に bwproxy のプログラムモード経由で取得した Yahoo! JAPAN の検索結果を縮めたもの */
const yahooHtml = readFileSync(new URL("./testdata/yahoo-search.html", import.meta.url), "utf8");

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: string, status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(body, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("parseYahooResults", () => {
  it("タイトル・URL・抜粋を取り出し、Yahoo 自身のリンクは除く", () => {
    const results = parseYahooResults(yahooHtml);
    expect(results.map((r) => r.url)).toEqual([
      "https://weathernews.jp/koyo/area/kyoto/calendar.html",
      "https://koyo.walkerplus.com/list/ar0726/",
    ]);
    expect(results[0].title).toBe("例年の紅葉見頃カレンダー（京都）【2026】 - ウェザーニュース");
    expect(results[0].snippet).toContain("ウェザーニューズが算出しています");
  });

  it("結果が無いページ（ボット判定など）では空配列を返す", () => {
    expect(
      parseYahooResults("<html><body>Unfortunately, bots use DuckDuckGo too.</body></html>"),
    ).toEqual([]);
  });
});

describe("htmlToText", () => {
  it("script・style を捨て、ブロック要素で改行し、実体参照を戻す", () => {
    const html =
      "<h1>見出し</h1><script>x()</script><style>p{}</style><p>本文&amp;続き&#12354;</p><div>次</div>";
    expect(htmlToText(html)).toBe("見出し\n本文&続きあ\n次");
  });
});

describe("fetchViaBwproxy", () => {
  it("プログラムモードで url パラメータに対象を渡す", async () => {
    const fetchMock = stubFetch("<p>ok</p>");
    await fetchViaBwproxy("https://bw.example", "https://a.example/x?y=1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://bw.example/proxy?url=https%3A%2F%2Fa.example%2Fx%3Fy%3D1",
      expect.objectContaining({ headers: { "X-Program-Mode": "true" } }),
    );
  });

  it("失敗したら BwproxyError を投げる", async () => {
    stubFetch('{"error":"render timed out","reason":"render_timeout"}', 504);
    await expect(fetchViaBwproxy("https://bw.example", "https://a.example")).rejects.toBeInstanceOf(
      BwproxyError,
    );
  });
});

describe("web_search", () => {
  it("Yahoo! JAPAN の検索 URL を bwproxy 経由で取得し、結果を番号付きで返す", async () => {
    const fetchMock = stubFetch(yahooHtml);
    const out = await createWebSearchTool("https://bw.example").execute({ query: "京都 紅葉" });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      encodeURIComponent("https://search.yahoo.co.jp/search?p="),
    );
    expect(out).toMatch(/^1\. 例年の紅葉見頃/);
    expect(out).toContain("2. ");
    expect(out).toContain("https://koyo.walkerplus.com/list/ar0726/");
  });

  it("結果が無ければ、別のキーワードを促す", async () => {
    stubFetch("<html></html>");
    await expect(
      createWebSearchTool("https://bw.example").execute({ query: "zzz" }),
    ).resolves.toContain("見つからなかった");
  });
});

describe("fetch_page", () => {
  it("本文を上限の文字数で切り詰める", async () => {
    stubFetch(`<p>${"あ".repeat(TUNING.bwproxy.pageMaxChars + 10)}</p>`);
    const out = await createFetchPageTool("https://bw.example").execute({
      url: "https://a.example",
    });
    expect(out.startsWith("あ".repeat(TUNING.bwproxy.pageMaxChars))).toBe(true);
    expect(out).toContain(`全 ${TUNING.bwproxy.pageMaxChars + 10} 字`);
  });

  it("http(s) 以外の URL は取得しない", async () => {
    const fetchMock = stubFetch("");
    await expect(
      createFetchPageTool("https://bw.example").execute({ url: "file:///etc/passwd" }),
    ).resolves.toContain("URL を指定");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
