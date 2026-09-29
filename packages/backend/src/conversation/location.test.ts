import { describe, expect, it } from "vitest";
import { formatLocation } from "./location.ts";

describe("formatLocation", () => {
  it("文字列の場合はそのまま出力する", () => {
    expect(formatLocation("東京都世田谷区")).toBe("現在地: 東京都世田谷区");
  });

  it("座標のみの場合は緯度・経度を出力する", () => {
    expect(formatLocation({ latitude: 35.6895, longitude: 139.6917 })).toBe(
      "現在地: 緯度 35.6895, 経度 139.6917",
    );
  });

  it("住所がある場合は住所と座標の両方を出力する", () => {
    expect(
      formatLocation({
        latitude: 35.6895,
        longitude: 139.6917,
        address: "東京都 新宿区 西新宿",
      }),
    ).toBe("現在地: 東京都 新宿区 西新宿（緯度 35.6895, 経度 139.6917）");
  });
});
