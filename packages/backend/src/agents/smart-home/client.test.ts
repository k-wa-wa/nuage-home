import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwitchBotClient, SwitchBotError } from "./client.ts";

describe("SwitchBotClient", () => {
  const token = "test-token";
  const secret = "test-secret";
  const client = new SwitchBotClient({ token, secret, baseUrl: "https://api.switch-bot.com/v1.1" });

  describe("generateHeaders", () => {
    it("HMAC-SHA256 署名と必須ヘッダーを正しく生成する", () => {
      const headers = client.generateHeaders();
      expect(headers.Authorization).toBe(token);
      expect(headers["Content-Type"]).toBe("application/json; charset=utf8");
      expect(headers.t).toBeDefined();
      expect(headers.nonce).toBeDefined();

      // 署名再計算の検証
      const expectedData = token + headers.t + headers.nonce;
      const expectedSign = crypto
        .createHmac("sha256", secret)
        .update(Buffer.from(expectedData, "utf-8"))
        .digest("base64");
      expect(headers.sign).toBe(expectedSign);
    });
  });

  describe("API リクエスト", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("getDevices: デバイス一覧を取得できる", async () => {
      const mockResponse = {
        statusCode: 100,
        message: "success",
        body: {
          deviceList: [
            { deviceId: "d1", deviceName: "フロアライト", deviceType: "Floor Lamp" },
            { deviceId: "d2", deviceName: "カーテン", deviceType: "Curtain3" },
          ],
          infraredRemoteList: [],
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const devices = await client.getDevices();
      expect(devices).toHaveLength(2);
      expect(devices[0].deviceName).toBe("フロアライト");
      expect(devices[1].deviceId).toBe("d2");
    });

    it("sendCommand: デバイスへコマンドを POST する", async () => {
      let requestedUrl = "";
      let requestedBody = "";

      globalThis.fetch = vi.fn().mockImplementation((url, init) => {
        requestedUrl = String(url);
        requestedBody = String(init.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ statusCode: 100, message: "success", body: {} }),
        } as Response);
      });

      await client.sendCommand("d1", "turnOn", "default");
      expect(requestedUrl).toBe("https://api.switch-bot.com/v1.1/devices/d1/commands");
      expect(JSON.parse(requestedBody)).toEqual({
        command: "turnOn",
        parameter: "default",
        commandType: "command",
      });
    });

    it("executeScene: シーンを実行できる", async () => {
      let requestedUrl = "";

      globalThis.fetch = vi.fn().mockImplementation((url) => {
        requestedUrl = String(url);
        return Promise.resolve({
          ok: true,
          json: async () => ({ statusCode: 100, message: "success", body: {} }),
        } as Response);
      });

      await client.executeScene("scene-123");
      expect(requestedUrl).toBe("https://api.switch-bot.com/v1.1/scenes/scene-123/execute");
    });

    it("API エラー時に SwitchBotError を投げる", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ statusCode: 190, message: "device internal error", body: {} }),
      } as Response);

      await expect(client.sendCommand("d1", "turnOn")).rejects.toThrow(SwitchBotError);
    });
  });
});
