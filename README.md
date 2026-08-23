# zDSH Plugin Center（zDSH 插件中心）

[![CI](https://github.com/zsagi1368/zdsh-plugin-center/actions/workflows/ci.yml/badge.svg)](./.github/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2563eb?style=flat-square)](./LICENSE)

> Discover, trust, install, update and audit DSH plugins from one built-in hub — safely, on Windows first.
>
> 在 DSH 内置的插件中枢里完成插件的发现、信任评估、安全安装、更新、启停与审计——Windows 一等公民。

**Status/状态**: v0.1.0 — first release. Docs: [中文说明](README.zh.md).

## What it is / 它是什么

An independent, clean-room DSH plugin that combines the best ideas from three
community plugin-hub projects into one safer, more convenient plugin center:

一个独立的净室 DSH 插件，把三个社区插件市场/管理器项目之长整合为一个更安全、更便捷的插件中心：

- **Marketplace discovery** with offline fallback and candidate quarantine /
  市场发现：离线降级 + 候选隔离视图
- **Trust evidence**: pinned commits, manifest integrity, lifecycle-script gating,
  permission preview / 信任证据：commit 固定、清单完整性、脚本门禁、权限预览
- **Safe lifecycle transactions**: plan → confirm → hash → backup → install →
  health check → rollback / 安全生命周期事务：计划→确认→哈希→备份→安装→健康检查→回滚
- **Cross-platform restart orchestration** (no launchd required) /
  跨平台重启编排（不依赖 launchd）
- **Audit viewer** with secret redaction / 无秘密审计查看器

## Install / 安装

```bash
dsh plugin --profile web add 'git+https://github.com/zsagi1368/zdsh-plugin-center.git#<release-commit>'
```

Then open `Settings → 插件中心` in your web profile. / 安装后打开 设置 → 插件中心。

## License

MIT — see [LICENSE](LICENSE).
