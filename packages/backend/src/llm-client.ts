import type { OpenAITool } from "./skills/types.ts"

export interface LlmClientOptions {
  baseUrl: string
  apiKey: string
  model: string
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface LlmResponse {
  content: string | null
  tool_calls?: ToolCall[]
}

/** エージェントが依存する LLM 呼び出しの形。実 LLM とモックを同じ形で差し替える */
export type ChatFn = (messages: LlmMessage[], tools: OpenAITool[]) => Promise<LlmResponse>

export function createLiteLlmChat(options: LlmClientOptions): ChatFn {
  return (messages, tools) => chat(options, messages, tools)
}

/**
 * LiteLLM (OpenAI互換API) を呼び出すクライアント関数
 */
export async function chat(
  options: LlmClientOptions,
  messages: LlmMessage[],
  tools?: OpenAITool[],
): Promise<LlmResponse> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages,
  }

  if (tools && tools.length > 0) {
    body.tools = tools
  }

  const res = await fetch(`${options.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`LiteLLM request failed: ${res.status} ${errorText}`)
  }

  const data = (await res.json()) as {
    choices?: {
      message?: {
        content?: string | null
        tool_calls?: ToolCall[]
      }
    }[]
  }

  const message = data.choices?.[0]?.message
  if (!message) {
    throw new Error("LiteLLM response missing choices[0].message")
  }

  return {
    content: message.content ?? null,
    tool_calls: message.tool_calls,
  }
}
