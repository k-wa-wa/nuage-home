import type { Task } from "@nuage-home/shared"
import type { ChatFn } from "../llm/client.ts"

/** 結果全文を、音声で伝える 1〜2 文に要約する */
export type Summarizer = (detail: string, task: Task) => Promise<string>

/**
 * 結果全文を、音声で伝える 1〜2 文に要約する。
 * ID・番号・略語は読み上げると聞き取りにくいため含めない（設計 6.4）。
 */
export function createLlmSummarizer(chat: ChatFn): Summarizer {
  return async (detail, task) => {
    const res = await chat(
      [
        {
          role: "system",
          content:
            "与えられた作業結果を、音声アシスタントが話す 1〜2 文の日本語に要約する。常体で、要点と次にすべきことだけを書く。Issue や PR の番号、タスク ID、英字の略語、記号、URL は含めず、「さっき頼まれた PR の調査」のような自然な言い方にする。要約文だけを出力する。",
        },
        { role: "user", content: `依頼: ${task.instruction}\n\n結果:\n${detail}` },
      ],
      [],
    )
    const text = res.content?.trim()
    if (!text) throw new Error("要約が空である")
    return text
  }
}

/** LLM を使わない要約。Markdown の記号・番号・ID を落とし、見出しを除いた先頭の 2 文だけを残す */
export const plainSummarizer: Summarizer = async (detail) => {
  const cleaned = detail
    .split("\n")
    // 見出し行は読み上げても意味が薄いため落とす
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ""))
    .join("\n")
    .replace(/\*\*|__|`/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s*[（(][^）)]*[）)]/g, "")
    .replace(/\s*#\d+/g, "")
    .replace(/\bt-\d+\b/g, "")
    .replace(/\s*\n\s*/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/。\s+/g, "。")
  return cleaned
    .split(/(?<=。)/)
    .slice(0, 2)
    .join("")
    .trim()
}

/**
 * 要約に上限時間を設け、超えたら（または失敗したら）代わりの要約を使う。
 * LLM の応答が遅いと通知そのものが遅れるため、会話の自然さを優先する。
 */
export function withFallback(primary: Summarizer, fallback: Summarizer, timeoutMs: number): Summarizer {
  return async (detail, task) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`要約が ${timeoutMs}ms で終わらなかった`)), timeoutMs)
    })
    try {
      return await Promise.race([primary(detail, task), timeout])
    } catch {
      return fallback(detail, task)
    } finally {
      clearTimeout(timer)
    }
  }
}
