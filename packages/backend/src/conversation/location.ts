import type { ClientLocation } from "@nuage-home/shared";

/**
 * 位置情報の文字列化。住所があれば住所と座標の両方を表示する。
 */
export function formatLocation(location: ClientLocation | string): string {
  if (typeof location === "string") return `現在地: ${location}`;
  const coords = `緯度 ${location.latitude.toFixed(4)}, 経度 ${location.longitude.toFixed(4)}`;
  if (location.address) return `現在地: ${location.address}（${coords}）`;
  return `現在地: ${coords}`;
}

/**
 * 緯度・経度から OpenStreetMap Nominatim を利用して大体の住所を取得する。
 * タイムアウトや失敗時は null を返す（会話をブロックしない）。
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  timeoutMs = 2000,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "nuage-home/1.0" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string };
    if (!data.display_name) return null;
    // Nominatim の display_name は狭い地名から順にカンマ区切りで並ぶため、
    // 国名や郵便番号を除外して逆順（都道府県 → 市区町村）に並べ替える
    const parts = data.display_name
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "日本" && !/^\d{3}-\d{4}$/.test(s))
      .reverse();
    return parts.length > 0 ? parts.join(" ") : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
