import { spawn } from "node:child_process";
import { TUNING } from "../constants.ts";
import type { ToolDefinition } from "./types.ts";

export interface SandboxExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type SandboxExecutor = (
  command: string[],
  input?: string,
  signal?: AbortSignal,
) => Promise<SandboxExecutionResult>;

/**
 * kubectl exec を使ってサンドボックスコンテナ内でコマンドを実行する Executor を生成する。
 */
export function createKubectlExecutor(
  target: string,
  namespace: string,
  timeoutMs: number = TUNING.sandbox.timeoutMs,
): SandboxExecutor {
  return (command, input, signal) => {
    return new Promise<SandboxExecutionResult>((resolve, reject) => {
      const args = ["exec", "-n", namespace, target, "-i", "--", ...command];
      const proc = spawn("kubectl", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let isDone = false;

      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          proc.kill("SIGKILL");
          resolve({
            exitCode: -1,
            stdout,
            stderr: `${stderr}\n実行タイムアウト（${timeoutMs}ms を超過しました）`,
          });
        }
      }, timeoutMs);

      const abortHandler = () => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          proc.kill("SIGKILL");
          reject(new Error("実行が中断されました"));
        }
      };

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          proc.kill("SIGKILL");
          return reject(new Error("実行が中断されました"));
        }
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.on("error", (err) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", abortHandler);
          reject(err);
        }
      });

      proc.on("close", (code) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", abortHandler);
          resolve({
            exitCode: code ?? 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          });
        }
      });

      if (input !== undefined) {
        proc.stdin.write(input);
      }
      proc.stdin.end();
    });
  };
}

export interface ExecutePythonArgs extends Record<string, unknown> {
  code?: string;
}

export function createExecutePythonTool(
  executor: SandboxExecutor,
): ToolDefinition<ExecutePythonArgs> {
  return {
    name: "execute_python",
    description:
      "サンドボックス環境内で Python 3 スクリプトを実行する。numpy, pandas, matplotlib 等が利用可能。グラフ画像を描画する場合は、メモリ上で PNG を Base64 エンコードして `__IMAGE_BASE64__:<base64>` というプレフィックス付きで出力すること。",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "実行する Python スクリプト。標準入力経由で python3 に渡される。",
        },
      },
      required: ["code"],
    },
    execute: async (args) => {
      const code = typeof args.code === "string" ? args.code : "";
      if (!code.trim()) return "実行する Python コードが指定されていません。";
      try {
        const res = await executor(["python3", "-"], code);
        const parts: string[] = [];
        if (res.stdout) parts.push(res.stdout);
        if (res.stderr) parts.push(`[stderr]\n${res.stderr}`);
        if (res.exitCode !== 0) parts.push(`[exit code: ${res.exitCode}]`);
        return parts.join("\n").trim() || "（出力なし）";
      } catch (err) {
        return `実行エラー: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

export interface ExecuteShellArgs extends Record<string, unknown> {
  command?: string;
}

export function createExecuteShellTool(
  executor: SandboxExecutor,
): ToolDefinition<ExecuteShellArgs> {
  return {
    name: "execute_shell",
    description:
      "サンドボックス環境内で bash コマンドを実行する。curl, jq, awk などの主要 CLI ツールが利用可能。",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "実行する bash コマンドライン（bash -c で実行される）。",
        },
      },
      required: ["command"],
    },
    execute: async (args) => {
      const command = typeof args.command === "string" ? args.command : "";
      if (!command.trim()) return "実行するコマンドが指定されていません。";
      try {
        const res = await executor(["bash", "-c", command]);
        const parts: string[] = [];
        if (res.stdout) parts.push(res.stdout);
        if (res.stderr) parts.push(`[stderr]\n${res.stderr}`);
        if (res.exitCode !== 0) parts.push(`[exit code: ${res.exitCode}]`);
        return parts.join("\n").trim() || "（出力なし）";
      } catch (err) {
        return `実行エラー: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
