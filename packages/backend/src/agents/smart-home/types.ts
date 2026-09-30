/**
 * SwitchBot Open API v1.1 のデータ型定義。
 * https://github.com/OpenWonderLabs/SwitchBotAPI
 */

export interface SwitchBotDevice {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  enableCloudService?: boolean;
  hubDeviceId?: string;
}

export interface SwitchBotInfraredRemote {
  deviceId: string;
  deviceName: string;
  remoteType: string;
  hubDeviceId: string;
}

export interface SwitchBotDevicesResponse {
  deviceList: SwitchBotDevice[];
  infraredRemoteList: SwitchBotInfraredRemote[];
}

export interface SwitchBotScene {
  sceneId: string;
  sceneName: string;
}

export interface SwitchBotApiResponse<T> {
  statusCode: number;
  message: string;
  body: T;
}

export interface DeviceCommandPayload {
  command: string;
  parameter?: string;
  commandType?: "command" | "customize";
}
