import crypto from "node:crypto";
import type {
  DeviceCommandPayload,
  SwitchBotApiResponse,
  SwitchBotDevice,
  SwitchBotDevicesResponse,
  SwitchBotScene,
} from "./types.ts";

export interface SwitchBotClientConfig {
  token: string;
  secret: string;
  baseUrl?: string;
}

export class SwitchBotError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "SwitchBotError";
    this.statusCode = statusCode;
  }
}

/**
 * SwitchBot Open API v1.1 クライアント。
 * HMAC-SHA256 によるリクエスト署名と各デバイス・シーンへのコマンド送信を担う。
 */
export class SwitchBotClient {
  private readonly token: string;
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(config: SwitchBotClientConfig) {
    this.token = config.token;
    this.secret = config.secret;
    this.baseUrl = (config.baseUrl ?? "https://api.switch-bot.com/v1.1").replace(/\/$/, "");
  }

  /**
   * API v1.1 の必須認証ヘッダーを生成する
   */
  generateHeaders(): Record<string, string> {
    const t = Date.now().toString();
    const nonce = crypto.randomUUID();
    const data = this.token + t + nonce;
    const sign = crypto
      .createHmac("sha256", this.secret)
      .update(Buffer.from(data, "utf-8"))
      .digest("base64");

    return {
      Authorization: this.token,
      sign,
      nonce,
      t,
      "Content-Type": "application/json; charset=utf8",
    };
  }

  /**
   * 登録されている物理デバイスの一覧を取得する
   */
  async getDevices(signal?: AbortSignal): Promise<SwitchBotDevice[]> {
    const res = await this.request<SwitchBotDevicesResponse>("/devices", {
      method: "GET",
      signal,
    });
    return res.deviceList ?? [];
  }

  /**
   * デバイスへコマンドを送信する
   */
  async sendCommand(
    deviceId: string,
    command: string,
    parameter: string = "default",
    commandType: "command" | "customize" = "command",
    signal?: AbortSignal,
  ): Promise<void> {
    const payload: DeviceCommandPayload = { command, parameter, commandType };
    await this.request<Record<string, unknown>>(
      `/devices/${encodeURIComponent(deviceId)}/commands`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        signal,
      },
    );
  }

  /**
   * 登録されているシーン（手動実行シーン）の一覧を取得する
   */
  async getScenes(signal?: AbortSignal): Promise<SwitchBotScene[]> {
    return this.request<SwitchBotScene[]>("/scenes", {
      method: "GET",
      signal,
    });
  }

  /**
   * シーンを実行する（電球グループなどの一括操作に利用）
   */
  async executeScene(sceneId: string, signal?: AbortSignal): Promise<void> {
    await this.request<Record<string, unknown>>(`/scenes/${encodeURIComponent(sceneId)}/execute`, {
      method: "POST",
      signal,
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = { ...this.generateHeaders(), ...(init.headers as Record<string, string>) };
    const url = `${this.baseUrl}${path}`;

    let response: Response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch (err) {
      throw new SwitchBotError(`SwitchBot API 通信エラー: ${String(err)}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new SwitchBotError(
        `SwitchBot API HTTP エラー (HTTP ${response.status}): ${text.slice(0, 200)}`,
        response.status,
      );
    }

    const json = (await response.json()) as SwitchBotApiResponse<T>;
    // SwitchBot API の成功コードは 100
    if (json.statusCode !== 100) {
      throw new SwitchBotError(
        `SwitchBot API 実行エラー (${json.statusCode}): ${json.message}`,
        json.statusCode,
      );
    }

    return json.body;
  }
}
