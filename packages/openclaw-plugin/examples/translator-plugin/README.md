# translator-plugin

中英互译示例插件。

## 功能

- 注册 `/translate` 命令
- 支持中英互译
- 通过 Hub / OpenClaw Gateway 的 OpenAI 兼容接口完成翻译

## 用法

```text
/translate 你好，世界
/translate hello world
/translate --to en 今天天气不错
/translate --to zh this plugin is ready
```

## 配置

可通过插件配置或环境变量指定 Gateway：

```yaml
plugins:
  entries:
    translator-example:
      path: /Users/jack/Documents/mack/orgclaw/packages/openclaw-plugin/examples/translator-plugin
      config:
        gatewayUrl: http://localhost:5337
        model: gpt-4o-mini
        apiKey: your-token
```

也支持环境变量：

- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_GATEWAY_MODEL`
- `OPENCLAW_GATEWAY_API_KEY`

## 说明

- 默认自动判断中英方向
- `--to en` 强制翻译成英文
- `--to zh` 强制翻译成中文
