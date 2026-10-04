import { describe, expect, it } from "vitest";
import {
  createExecutePythonTool,
  createExecuteShellTool,
  type SandboxExecutor,
} from "./sandbox.ts";

describe("sandbox tools", () => {
  describe("execute_python", () => {
    it("Python コードを実行して標準出力を返す", async () => {
      const mockExecutor: SandboxExecutor = async (command, input) => {
        expect(command).toEqual(["python3", "-"]);
        expect(input).toBe("print('hello')");
        return { exitCode: 0, stdout: "hello", stderr: "" };
      };

      const tool = createExecutePythonTool(mockExecutor);
      const res = await tool.execute({ code: "print('hello')" });
      expect(res).toBe("hello");
    });

    it("エラー出力を整形して返す", async () => {
      const mockExecutor: SandboxExecutor = async () => {
        return { exitCode: 1, stdout: "", stderr: "SyntaxError" };
      };

      const tool = createExecutePythonTool(mockExecutor);
      const res = await tool.execute({ code: "invalid" });
      expect(res).toMatch(/\[stderr\]\nSyntaxError/);
      expect(res).toMatch(/\[exit code: 1\]/);
    });

    it("コードが空の場合はエラーメッセージを返す", async () => {
      let called = false;
      const mockExecutor: SandboxExecutor = async () => {
        called = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const tool = createExecutePythonTool(mockExecutor);
      const res = await tool.execute({ code: "" });
      expect(called).toBe(false);
      expect(res).toMatch(/指定されていません/);
    });
  });

  describe("execute_shell", () => {
    it("bash コマンドを実行して結果を返す", async () => {
      const mockExecutor: SandboxExecutor = async (command) => {
        expect(command).toEqual(["bash", "-c", "echo test"]);
        return { exitCode: 0, stdout: "test", stderr: "" };
      };

      const tool = createExecuteShellTool(mockExecutor);
      const res = await tool.execute({ command: "echo test" });
      expect(res).toBe("test");
    });

    it("コマンドが空の場合はエラーメッセージを返す", async () => {
      let called = false;
      const mockExecutor: SandboxExecutor = async () => {
        called = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const tool = createExecuteShellTool(mockExecutor);
      const res = await tool.execute({ command: "  " });
      expect(called).toBe(false);
      expect(res).toMatch(/指定されていません/);
    });
  });
});
