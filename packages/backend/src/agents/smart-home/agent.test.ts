import { describe, expect, it, vi } from "vitest";
import type { ChatFn, LlmResponse } from "../../llm/client.ts";
import { createSmartHomeAgent } from "./agent.ts";
import type { SwitchBotClient } from "./client.ts";
import { createSmartHomeTools } from "./tools.ts";
import type { SwitchBotDevice, SwitchBotScene } from "./types.ts";

describe("SmartHomeAgent", () => {
  const mockDevices: SwitchBotDevice[] = [
    { deviceId: "d-floor", deviceName: "フロアライト", deviceType: "Floor Lamp" },
    { deviceId: "d-curtain", deviceName: "カーテン", deviceType: "Curtain3" },
    { deviceId: "d-strip", deviceName: "テープライト", deviceType: "Strip Light" },
  ];

  const mockScenes: SwitchBotScene[] = [
    { sceneId: "s-bulbs-off", sceneName: "電球グループOFF" },
    { sceneId: "s-bulbs-on", sceneName: "電球グループON" },
  ];

  function createMockClient(): SwitchBotClient {
    return {
      getDevices: vi.fn().mockResolvedValue(mockDevices),
      getScenes: vi.fn().mockResolvedValue(mockScenes),
      sendCommand: vi.fn().mockResolvedValue(undefined),
      executeScene: vi.fn().mockResolvedValue(undefined),
    } as unknown as SwitchBotClient;
  }

  it("家電操作の指示に対して control_device ツールを呼び出す", async () => {
    const client = createMockClient();
    const tools = createSmartHomeTools(client);

    // 1 回目で control_device を呼び出し、2 回目で結果を報告するモック LLM
    let step = 0;
    const mockChat: ChatFn = vi.fn().mockImplementation(async () => {
      step++;
      if (step === 1) {
        return {
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "control_device",
                arguments: JSON.stringify({ target: "フロアライト", command: "turnOn" }),
              },
            },
          ],
        } as LlmResponse;
      }
      return {
        content: "フロアライトを点灯しました。",
      } as LlmResponse;
    });

    const agent = createSmartHomeAgent({
      chat: mockChat,
      tools,
      logger: { info: () => {} },
    });

    const result = await agent.ask("フロアライトをつけて", new AbortController().signal);

    expect(client.sendCommand).toHaveBeenCalledWith("d-floor", "turnOn", "default");
    expect(result).toBe("フロアライトを点灯しました。");
  });

  it("シーンの指示に対して run_scene ツールを呼び出す", async () => {
    const client = createMockClient();
    const tools = createSmartHomeTools(client);

    let step = 0;
    const mockChat: ChatFn = vi.fn().mockImplementation(async () => {
      step++;
      if (step === 1) {
        return {
          content: null,
          tool_calls: [
            {
              id: "call_2",
              type: "function",
              function: {
                name: "run_scene",
                arguments: JSON.stringify({ scene: "電球グループOFF" }),
              },
            },
          ],
        } as LlmResponse;
      }
      return {
        content: "電球グループを消灯しました。",
      } as LlmResponse;
    });

    const agent = createSmartHomeAgent({
      chat: mockChat,
      tools,
      logger: { info: () => {} },
    });

    const result = await agent.ask("電球を全部消して", new AbortController().signal);

    expect(client.executeScene).toHaveBeenCalledWith("s-bulbs-off");
    expect(result).toBe("電球グループを消灯しました。");
  });
});
