import { afterEach, describe, expect, it, vi } from "vitest";
import { TUNING } from "../constants.ts";
import { BwproxyError, fetchViaBwproxy, htmlToText } from "./bwproxy.ts";
import { createFetchPageTool } from "./fetch-page.ts";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: string, status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(body, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

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
