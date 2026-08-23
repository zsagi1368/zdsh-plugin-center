# Changelog — zdsh-plugin-center

All notable changes are documented here. Format follows Keep a Changelog;
versioning is semver. 中文说明见同文件下半部分。

## [0.1.0] - 2026-08-24

First public release of the zDSH Plugin Center as an independent, clean-room
DSH plugin. Ideas integrated and re-designed from three community plugin-hub
projects (dsh-hub-plugin, dsh-safe-plugin-manager, dsh-plugins); zero code
reused.

### Added

- **Marketplace discovery**: bounded 24-per-page listing with search,
  category filter, recommended-only toggle, three badges per entry
  (trust evidence, compatibility projection, pinned source), offline
  degradation to the bundled seed catalog.
- **Trust model**: GitHub targets pinned to exact 40-hex commits; catalog
  entries carry evidence levels (discovered/installable/verified/recommended);
  candidate pool is type-forbidden from carrying installable fields.
- **Safe lifecycle transactions**: one-shot plans with content-bound
  confirmation phrases → profile pre-hash → backup snapshot → pinned official
  CLI invocation (force-add forbidden) → post-state comparison → health probe
  → byte-exact verified rollback on any failure → secret-free JSONL audit.
- **Lifecycle script gate**: plans whose target declares unlisted
  lifecycle scripts are refused (`script_blocked`).
- **HTTP surface** under `/api2/zdsh-plugin-center/*`: same-origin
  enforcement, mutation intent header, read-only mode, bounded bodies,
  stable status-code mapping.
- **Self-guardian watchdog**: detached Node process probing a hardcoded
  loopback address, bounded restarts (3 per 5 minutes) with give-up state,
  status mirrored to disk; no launchd/schtasks/systemd required.
- **Web client**: settings section (order 30) with bilingual zh/en UI,
  theme alias variables, one-shot confirm dialog requiring the phrase code,
  boot guard refreshing once when the host reloads under a new boot id.
- Seed catalog with six verified installable community plugins.
- CI: lint + build + test on ubuntu and windows runners.

[0.1.0]: https://github.com/zsagi1368/zdsh-plugin-center/releases/tag/v0.1.0

---

## 中文

## [0.1.0] - 2026-08-24

zDSH 插件中心首个公开版本（独立净室插件）。整合三家社区插件市场/管理器项目的思想并重新设计，零代码复用。

### 新增

- **市场发现**：每页 24 条有界列表，支持搜索、分类过滤、只看推荐；每条目三徽章（信任证据、兼容性投影、固定来源）；离线时降级到随包种子目录。
- **信任模型**：GitHub 目标固定 40 位 commit；条目带四级证据；候选库在类型层面禁止携带可安装字段。
- **安全生命周期事务**：一次性计划 + 内容绑定确认语 → profile 前置哈希 → 备份快照 → 固定参数官方 CLI（禁止 force-add）→ 后置比对 → 健康探测 → 任一步失败逐字回滚并校验字节 → 无秘密 JSONL 审计。
- **生命周期脚本门禁**：目标声明未放行脚本时拒绝执行（script_blocked）。
- **HTTP 面** `/api2/zdsh-plugin-center/*`：同源校验、变更意图头、只读模式、请求体上限、稳定状态码映射。
- **自守护看门狗**：独立 Node 进程探测固定环回地址，5 分钟内最多重启 3 次后熔断放弃，状态落盘；不依赖 launchd/schtasks/systemd。
- **Web 客户端**：设置页分区（order 30），中英双语，主题别名变量，需输入确认码的一次性确认弹窗，宿主重载后 Boot Guard 单次刷新。
- 种子目录含六个已核实的可安装社区插件。
- CI：ubuntu 与 windows 双跑道的 lint + 构建 + 测试。
