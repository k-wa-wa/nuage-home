import { describe, expect, it } from "vitest"
import type { Task } from "@nuage-home/shared"
import { plainSummarizer, withFallback } from "./summarizer.ts"

const task = { instruction: "調査" } as Task

describe("plainSummarizer", () => {
  it("番号・ID・括弧書き・URL・改行を落とし、先頭 2 文を残す", async () => {
    const detail = "PR #123 (feat: x) は t-1 で止まっている。\n再実行で通る見込み。\n詳細: https://example.com/a"
    expect(await plainSummarizer(detail, task)).toBe("PR は で止まっている。再実行で通る見込み。")
  })
})

describe("plainSummarizer（Markdown のレポート）", () => {
  it("見出しを落とし、強調・箇条書きの記号を外す", async () => {
    const detail = "# 調査レポート\n## 結論\n1. **検索では最近の動向を確認できなかった。** 別の方法で調べる必要がある。\n- 補足"
    expect(await plainSummarizer(detail, task)).toBe("検索では最近の動向を確認できなかった。別の方法で調べる必要がある。")
  })
})

describe("withFallback", () => {
  it("上限時間を超えたら代わりの要約を使う", async () => {
    const slow = () => new Promise<string>((r) => setTimeout(() => r("遅い要約"), 200))
    const s = withFallback(slow, async () => "代わりの要約", 20)
    expect(await s("x", task)).toBe("代わりの要約")
  })

  it("失敗したら代わりの要約を使う", async () => {
    const s = withFallback(async () => { throw new Error("x") }, async () => "代わりの要約", 1000)
    expect(await s("x", task)).toBe("代わりの要約")
  })

  it("間に合えば本来の要約を使う", async () => {
    const s = withFallback(async () => "本来の要約", async () => "代わりの要約", 1000)
    expect(await s("x", task)).toBe("本来の要約")
  })
})
