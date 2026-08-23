# zDSH 插件中心（zdsh-plugin-center）

> 在 DSH 内置的插件中枢里完成插件的发现、信任评估、安全安装、更新、启停与审计——Windows 一等公民。

状态：开发中（M1）。英文说明见 [README.md](README.md)。

## 核心能力

- **市场发现**：搜索/分类/有界分页/三态安装性徽章；网络失败自动降级到随包快照；候选库与可信目录物理隔离。
- **信任证据**：40 位 commit 固定 + sha256 清单完整性 + 生命周期脚本默认全拒（显式放行）+ 权限预览。
- **安全生命周期**：一次性计划 → 确认语 → profile 前置哈希 → 备份 → 受控安装 → 健康检查 → 失败逐字回滚；全程无秘密审计。
- **跨平台重启编排**：Node 自守护助手 + Boot ID 握手 + 有界重启（5 分钟 ≤3 次）+ 熔断，不依赖 launchd/schtasks。
- **双语界面**：中文默认，设置页内切换。

## 安装

```bash
dsh plugin --profile web add 'git+https://github.com/zsagi1368/zdsh-plugin-center.git#<release-commit>'
```

安装并重启 web profile 后打开：`设置 → 插件中心`。

## 安全声明

本插件不绕过 DSH 权限系统；安装目标只认固定 commit；所有出站请求经 SSRF 守卫（仅 http/https，拒绝内网/环回/保留地址）；审计日志永不记录凭据。

## 许可

MIT — 见 [LICENSE](LICENSE)。
