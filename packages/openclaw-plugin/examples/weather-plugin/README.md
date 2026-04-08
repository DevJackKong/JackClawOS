# weather-plugin

天气查询示例插件。

## 功能

- 注册 `/weather` 命令
- 调用公开天气 API：`wttr.in`
- 返回格式化天气信息

## 用法

```text
/weather 北京
/weather Shanghai
/weather
```

不传参数时默认查询 `Shanghai`。

## 返回示例

```text
🌤️ Beijing 天气
天气：Partly cloudy
温度：22°C
体感：24°C
湿度：65%
风速：11 km/h
```

## 接入方式

在 `openclaw.yaml` 中注册插件入口，例如：

```yaml
plugins:
  entries:
    weather-example:
      path: /Users/jack/Documents/mack/orgclaw/packages/openclaw-plugin/examples/weather-plugin
```

如果运行时要求构建产物，可将本文件改为包入口并输出到 `dist/index.js`。
