import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import type {
  OpenClawPluginCommandDefinition,
  PluginCommandContext,
} from 'openclaw/plugin-sdk/plugin-entry'

function reply(text: string) {
  return { text }
}

function parseLocation(args: string): string {
  const location = args.trim()
  return location || 'Shanghai'
}

async function handleWeather(ctx: PluginCommandContext) {
  const location = parseLocation(ctx.args ?? '')
  const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      return reply(`❌ 天气查询失败：HTTP ${res.status}`)
    }

    const data = await res.json() as {
      current_condition?: Array<{
        temp_C?: string
        FeelsLikeC?: string
        humidity?: string
        weatherDesc?: Array<{ value?: string }>
        windspeedKmph?: string
      }>
      nearest_area?: Array<{ areaName?: Array<{ value?: string }> }>
    }

    const current = data.current_condition?.[0]
    const area = data.nearest_area?.[0]?.areaName?.[0]?.value ?? location

    if (!current) {
      return reply(`⚠️ 未找到 ${location} 的天气数据`)
    }

    const desc = current.weatherDesc?.[0]?.value ?? '未知'
    return reply(
      [
        `🌤️ ${area} 天气`,
        `天气：${desc}`,
        `温度：${current.temp_C ?? '-'}°C`,
        `体感：${current.FeelsLikeC ?? '-'}°C`,
        `湿度：${current.humidity ?? '-'}%`,
        `风速：${current.windspeedKmph ?? '-'} km/h`,
      ].join('\n'),
    )
  } catch (error) {
    return reply(`❌ 天气查询异常：${(error as Error).message}`)
  }
}

const weatherCommand: OpenClawPluginCommandDefinition = {
  name: 'weather',
  description: '查询天气。用法：/weather 北京',
  acceptsArgs: true,
  requireAuth: false,
  handler: handleWeather,
}

export default definePluginEntry({
  id: 'example-weather-plugin',
  name: 'Weather Plugin Example',
  description: '示例天气插件：注册 /weather 命令，查询 wttr.in 天气。',
  register(api) {
    api.registerCommand(weatherCommand)
    api.logger.info('[example-weather-plugin] registered /weather')
  },
})
