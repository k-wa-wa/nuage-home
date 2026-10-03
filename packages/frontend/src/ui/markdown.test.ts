// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.ts";

describe("renderMarkdown", () => {
  it("見出しや箇条書き等の基本的な Markdown を HTML に変換する", () => {
    const md = "# 調査レポート\n\n- 項目1\n- 項目2\n\n**重要なお知らせ**";
    const html = renderMarkdown(md);

    expect(html).toContain("<h1>調査レポート</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>項目1</li>");
    expect(html).toContain("<strong>重要なお知らせ</strong>");
  });

  it("外部リンクに target='_blank' と rel='noopener noreferrer' を付与する", () => {
    const md = "[公式ドキュメント](https://example.com/docs)";
    const html = renderMarkdown(md);

    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("スクリプトや不正な属性を含む XSS ペイロードをサニタイズする", () => {
    const md = '危険なスクリプト: <script>alert("xss")</script><img src="x" onerror="alert(1)">';
    const html = renderMarkdown(md);

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onerror");
  });

  it("空文字列が与えられた場合は空文字を返す", () => {
    expect(renderMarkdown("")).toBe("");
  });
});
