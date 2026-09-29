import type { ToolDefinition } from "./types.ts"

// 日本の主要都市の座標マップ（API呼び出しを省いて高速化・安定化）
const CITY_COORDINATES: Record<string, { lat: number; lon: number; name: string }> = {
  東京: { lat: 35.6895, lon: 139.6917, name: "東京都" },
  tokyo: { lat: 35.6895, lon: 139.6917, name: "東京都" },
  横浜: { lat: 35.4437, lon: 139.638, name: "横浜市" },
  大阪: { lat: 34.6937, lon: 135.5023, name: "大阪市" },
  名古屋: { lat: 35.1815, lon: 136.9066, name: "名古屋市" },
  札幌: { lat: 43.0618, lon: 141.3545, name: "札幌市" },
  福岡: { lat: 33.5904, lon: 130.4017, name: "福岡市" },
  京都: { lat: 35.0116, lon: 135.7681, name: "京都市" },
  神戸: { lat: 34.6901, lon: 135.1955, name: "神戸市" },
  仙台: { lat: 38.2682, lon: 140.8694, name: "仙台市" },
  広島: { lat: 34.3853, lon: 132.4553, name: "広島市" },
  那覇: { lat: 26.2124, lon: 127.6809, name: "那覇市" },
  沖縄: { lat: 26.2124, lon: 127.6809, name: "那覇市" },
}

// WMO 天気コード対応表
const WEATHER_CODE_TEXT: Record<number, string> = {
  0: "快晴",
  1: "概ね晴れ",
  2: "一部曇り",
  3: "曇り",
  45: "霧",
  48: "霧",
  51: "霧雨",
  53: "霧雨",
  55: "霧雨",
  61: "小雨",
  63: "雨",
  65: "大雨",
  66: "雨または雪（凍雨）",
  67: "雨または雪（凍雨）",
  71: "小雪",
  73: "雪",
  75: "大雪",
  77: "霧雪",
  80: "にわか雨",
  81: "にわか雨",
  82: "にわか雨",
  85: "にわか雪",
  86: "にわか雪",
  95: "雷雨",
  96: "雷雨（雹を伴う）",
  99: "雷雨（雹を伴う）",
}

function weatherCodeToText(code: number): string {
  return WEATHER_CODE_TEXT[code] ?? "不明"
}

interface GeocodingResult {
  results?: {
    name: string
    latitude: number
    longitude: number
    admin1?: string
  }[]
}

interface OpenMeteoForecastResponse {
  current?: {
    temperature_2m: number
    weather_code: number
  }
  daily?: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_probability_max: number[]
  }
}

type DailyForecast = NonNullable<OpenMeteoForecastResponse["daily"]>

function formatDailyForecast(label: string, daily: DailyForecast, i: number): string {
  const dateStr = daily.time[i] ?? ""
  const cond = weatherCodeToText(daily.weather_code[i])
  const max = Math.round(daily.temperature_2m_max[i])
  const min = Math.round(daily.temperature_2m_min[i])
  const rain = daily.precipitation_probability_max[i] ?? 0
  return `${label}（${dateStr}）: ${cond}、最高 ${max}℃ / 最低 ${min}℃、降水確率 ${rain}%`
}

/**
 * 天気予報ツール
 * Open-Meteo API を利用し、指定地域の現在天気および今日・明日・明後日・週間の予報を取得する。
 */
export const weatherTool: ToolDefinition = {
  name: "weather",
  description: "指定した地域の現在の天気、気温、降水確率、今日・明日・明後日および週間（最大7日間）の天気予報を取得する",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "都市名や地域名（例: '東京', '大阪', '札幌'）。省略時は東京。",
      },
    },
  },
  execute: async (args) => {
    const rawLoc = typeof args.location === "string" ? args.location.trim() : ""
    const queryLoc = rawLoc || "東京"

    let lat: number
    let lon: number
    let locationName = queryLoc

    const cachedCity = CITY_COORDINATES[queryLoc] ?? CITY_COORDINATES[queryLoc.replace(/[都道府県市区町村]/g, "")]
    if (cachedCity) {
      lat = cachedCity.lat
      lon = cachedCity.lon
      locationName = cachedCity.name
    } else {
      // ジオコーディングAPIで座標を検索
      try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(queryLoc)}&count=1&language=ja`
        const geoRes = await fetch(geoUrl)
        if (!geoRes.ok) {
          return `地域「${queryLoc}」の座標取得に失敗した。`
        }
        const geoData = (await geoRes.json()) as GeocodingResult
        const first = geoData.results?.[0]
        if (!first) {
          return `地域「${queryLoc}」が見つからなかった。別の地名を指定してください。`
        }
        lat = first.latitude
        lon = first.longitude
        locationName = first.admin1 ? `${first.admin1} ${first.name}` : first.name
      } catch (err) {
        return `地域座標の検索中にエラーが発生した: ${String(err)}`
      }
    }

    try {
      const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo`
      const res = await fetch(forecastUrl)
      if (!res.ok) {
        return `天気予報データの取得に失敗した（HTTP ${res.status}）。`
      }

      const data = (await res.json()) as OpenMeteoForecastResponse
      const current = data.current
      const daily = data.daily

      const lines: string[] = [`【${locationName}の天気予報】`]

      if (current) {
        const cond = weatherCodeToText(current.weather_code)
        lines.push(`現在: ${cond}、気温 ${Math.round(current.temperature_2m)}℃`)
      }

      if (daily && daily.time.length > 0) {
        const relativeLabels = ["今日", "明日", "明後日", "3日後", "4日後", "5日後", "6日後"]
        const count = Math.min(daily.time.length, 7)
        for (let i = 0; i < count; i++) {
          const label = relativeLabels[i] ?? `${i}日後`
          lines.push(formatDailyForecast(label, daily, i))
        }
      }

      return lines.join("\n")
    } catch (err) {
      return `天気情報の取得中にエラーが発生した: ${String(err)}`
    }
  },
}
