import { ToolRegistry } from "../../tools/registry.ts";
import type { ToolArgs, ToolDefinition } from "../../tools/types.ts";
import type { SwitchBotClient } from "./client.ts";
import type { SwitchBotDevice, SwitchBotScene } from "./types.ts";

export interface DeviceCache {
  devices: SwitchBotDevice[];
  scenes: SwitchBotScene[];
  fetchedAt: number;
}

/**
 * SwitchBot を操作するツール群（list_devices, control_device, run_scene）を生成する。
 */
export function createSmartHomeTools(client: SwitchBotClient): ToolRegistry {
  let cache: DeviceCache | null = null;
  const CACHE_TTL_MS = 60_000;

  async function getCachedInfo(): Promise<{
    devices: SwitchBotDevice[];
    scenes: SwitchBotScene[];
  }> {
    const now = Date.now();
    if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
      return { devices: cache.devices, scenes: cache.scenes };
    }
    const [devices, scenes] = await Promise.all([
      client.getDevices().catch(() => []),
      client.getScenes().catch(() => []),
    ]);
    cache = { devices, scenes, fetchedAt: now };
    return { devices, scenes };
  }

  const listDevicesTool: ToolDefinition = {
    name: "list_devices",
    description: "利用可能な SwitchBot 家電デバイスおよびシーンの一覧を取得する。",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      const { devices, scenes } = await getCachedInfo();
      const devList = devices.map(
        (d) => `- ${d.deviceName} (ID: ${d.deviceId}, 種類: ${d.deviceType})`,
      );
      const sceneList = scenes.map((s) => `- ${s.sceneName} (ID: ${s.sceneId})`);

      return [
        "【家電デバイス一覧】:",
        devList.length > 0 ? devList.join("\n") : "（登録デバイスなし）",
        "",
        "【シーン一覧（電球グループ等の手動実行）】:",
        sceneList.length > 0 ? sceneList.join("\n") : "（登録シーンなし）",
      ].join("\n");
    },
  };

  const controlDeviceTool: ToolDefinition = {
    name: "control_device",
    description:
      "指定した家電デバイスを操作する。turnOn/turnOff, setBrightness (1-100), setColor (RGB '255:128:0'), setPosition (カーテン 0-100) などを指定する。",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            "対象のデバイス名または deviceId（例: 'フロアライト', 'カーテン', 'テープライト'）",
        },
        command: {
          type: "string",
          description: "実行するコマンド名",
          enum: [
            "turnOn",
            "turnOff",
            "setBrightness",
            "setColor",
            "setColorTemperature",
            "setPosition",
          ],
        },
        parameter: {
          type: "string",
          description:
            "コマンドのパラメータ。turnOn/turnOff は 'default'、明るさは '1'〜'100'、色は '255:128:0'、カーテン位置は '0,ff,50'（50%開く）または '50'。",
        },
      },
      required: ["target", "command"],
    },
    async execute(args: ToolArgs) {
      const target = String(args.target ?? "").trim();
      const command = String(args.command ?? "").trim();
      let parameter = args.parameter !== undefined ? String(args.parameter).trim() : "default";

      if (!target || !command) return "エラー: target と command は必須である。";

      const { devices } = await getCachedInfo();
      // deviceId 完全一致または deviceName 部分一致で特定
      const device =
        devices.find((d) => d.deviceId === target) ??
        devices.find((d) => d.deviceName.toLowerCase().includes(target.toLowerCase()));

      const deviceId = device ? device.deviceId : target;
      const deviceName = device ? device.deviceName : target;

      // カーテンの setPosition パラメータ補正（数値のみの場合は '0,ff,<pct>' 形式へ変換）
      if (command === "setPosition" && /^\d+$/.test(parameter)) {
        parameter = `0,ff,${parameter}`;
      }

      await client.sendCommand(deviceId, command, parameter);
      return `${deviceName} の ${command}（パラメータ: ${parameter}）を実行した。`;
    },
  };

  const runSceneTool: ToolDefinition = {
    name: "run_scene",
    description:
      "SwitchBot アプリで設定されたシーンを実行する（電球グループの一括点灯・消灯などに有効）。",
    parameters: {
      type: "object",
      properties: {
        scene: {
          type: "string",
          description: "対象のシーン名または sceneId",
        },
      },
      required: ["scene"],
    },
    async execute(args: ToolArgs) {
      const sceneInput = String(args.scene ?? "").trim();
      if (!sceneInput) return "エラー: scene は必須である。";

      const { scenes } = await getCachedInfo();
      const match =
        scenes.find((s) => s.sceneId === sceneInput) ??
        scenes.find((s) => s.sceneName.toLowerCase().includes(sceneInput.toLowerCase()));

      if (!match) {
        return `エラー: シーン '${sceneInput}' が見つからなかった。list_devices で利用可能なシーンを確認されたい。`;
      }

      await client.executeScene(match.sceneId);
      return `シーン '${match.sceneName}' を実行した。`;
    },
  };

  return new ToolRegistry([listDevicesTool, controlDeviceTool, runSceneTool]);
}
