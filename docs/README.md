# 文档导航

| 需要做什么 | 阅读位置 |
| --- | --- |
| 安装、运行、了解项目结构 | [项目说明](../README.md) |
| 修改、发布、核对上线记录、同步文本副本 | [站长手册](MAINTAINER.md) |
| 将 Railway 后端迁到 Vercel、导入留言和切换 API | [Vercel 迁移](VERCEL.md) |
| 查构建、检查与数据维护命令 | [工具导航](../tools/README.md) |
| 了解当前安全边界与部署约束 | [安全与运维说明](SECURITY.md) |
| 报告安全问题 | [安全报告渠道](../SECURITY.md) |
| 查访客可见的变更和真实发布记录 | [更新日志](CHANGELOG.md) |
| 查优化过程和验证结果 | [优化记录](OPTIMIZATION.md) |
| 接手维护 | [交接说明](AI_HANDOFF.md) |
| 查旧审计和阶段性结论 | [历史报告](history/) |

当前维护规则以站长手册和仓库根目录的 `AGENTS.md` 为准；历史报告反映当时的版本，不能替代当前规则。

## 项目目录

| 位置 | 用途 |
| --- | --- |
| 根目录的 HTML、CSS、`script.js`、`js/` | 站点页面与前端脚本 |
| `images/`、`fonts/`、`data/` | 图片、字体与发布数据 |
| `backend/` | 登录、留言及后端服务 |
| `tools/`、`tools/tests/`、`docs/` | 构建维护工具、测试与文档 |
| `dist/` | 构建生成的公开目录，不直接编辑 |
| `inabakumori-assets-src/NKNK/` | 本机画廊原图，Git 忽略；用于生成 WebP |
| `inabakumori-site-all-code/` | 本机文本副本，Git 忽略 |

本地检查产物统一放在被 Git 忽略的 `artifacts/`：`reports/` 保存报告和整理清单，`logs/` 保存命令日志，`verifications/` 保存部署核验结果，`scans/` 保存公开帖子采集原件，`manual-scripts/` 保存历史手工检查脚本，`screens/` 保存截图，`benchmarks/` 保存性能测量与产物哈希。联网门禁仍使用根下的 `artifacts/changelog-api-cache.json`。私有运维笔记放在同样被忽略的 `.local-notes/`，文本副本放在 `inabakumori-site-all-code/`。

`artifacts/finder-duplicates/` 按原路径保存整理出的旧副本，内容不一定相同，不能直接当作重复文件删除。

上述本地材料、文档和工具均不进入公开构建；网站只部署构建白名单生成的 `dist/`。
