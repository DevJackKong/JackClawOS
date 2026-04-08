# reminder-plugin

提醒示例插件。

## 功能

- 注册 `/remind` 命令
- 支持 `/remind 30m 开会` 格式
- 用 `setTimeout` 实现 demo 级提醒

## 用法

```text
/remind 30m 开会
/remind 10s 喝水
/remind 2h 提交日报
```

## 支持时间单位

- `s` 秒
- `m` 分钟
- `h` 小时
- `d` 天

## 返回示例

```text
⏰ 已设置提醒
ID：reminder-...
时间：30m
内容：开会
```

## 注意

这是 demo 实现：

- 仅依赖当前 Node.js 进程内存
- 进程重启后提醒会丢失
- 到时后默认写日志 / 控制台，不做跨渠道推送
