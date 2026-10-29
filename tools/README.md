# 工具导航

从仓库根目录运行命令，使用 Node.js 24；文本副本工具使用 Python 3。修改后的提交、发布、上线核验顺序见[站长手册](../docs/MAINTAINER.md#每次改完看什么)。

## 日常命令

| 命令 | 用途与写入范围 |
| --- | --- |
| `npm run frontend` | 从源码预览公开页面；只服务公开路径白名单 |
| `npm run backend` | 启动后端，使用本机已配置的环境和数据库；配置见 `backend/` |
| `npm run build` | 重建 `dist/` 和生成的 `js/auth.js`，移除生产 CSP 中的本地 API 地址 |
| `npm run preview` | 构建供本地 API 使用的 `dist/` 后启动预览；发布使用 `npm run build` |
| `npm test` | 运行 `tests/` 中的回归测试，写入临时测试夹具 |
| `npm run check` | lint、离线上线表结构、测试、后端语法、构建与公开产物检查 |
| `npm run test:integration` | 使用隔离临时数据库验证 HTTP 接口 |
| `npm run check:changelog` | 联网核对 GitHub Actions 与上线记录，更新本地 API 缓存 |
| `npm run check:links` | 联网检查公开外链；`check:links:strict` 将全部失败计入退出状态 |
| `python3 tools/sync-copy.py` | 发布核验后，将已提交文本导出到被忽略的本地副本目录 |
| `python3 tools/sync-copy.py --check` | 只核对副本与 Git HEAD，不改写副本 |
| `python3 tools/remote-backup.py <私有配置.json>` | 从生产受保护接口下载并验证留言快照，仅保存于私有目录；配置、令牌和备份不进仓库，细节见[迁移说明](../docs/VERCEL.md#回退与后续备份) |

提交前必须通过 `npm test`、`npm run check`、`npm run test:integration`、`npm run check:changelog` 四项门禁。后者的网络或限流失败不能用离线结构检查代替。

## 数据与资源维护

| 入口 | 职责 |
| --- | --- |
| `refresh-creator-updates.mjs` | 联网核实官方作品来源，更新 `data/creator-updates.json`；来源失败非零退出并保留已有内容 |
| `refresh-youtube-views.mjs` | 使用环境中的 API 密钥刷新 `js/songs.js` 播放量 |
| `import-x-posts.mjs <public-posts-scan.json>` | 校验并合并公开帖子采集文件，重建 `data/x-posts/` 分片和清单；冲突须复核 |
| `npm run optimize:images` | 使用本机编码工具，将保留的原图生成到 `images/optimized/` |
| `npm run generate:nknk` | 从仓库外的图库原图重建画廊 WebP 与数据；原图目录由 `NKNK_SOURCE_DIR` 指定，默认为仓库同级的 `../inabakumori-assets-src/NKNK`。`-- --config-only` 只按已提交的 WebP 重写 `js/nknk-gallery.js`，不需要原图 |
| `record-current-deployment.mjs` | 供定时动态流程补记已核实的 main/push 发布；人工维护按手册由最终提交者独占补表 |

采集原件和执行日志放入 `artifacts/` 对应子目录；经过校验、需要发布的数据保留在 `data/`。整理目录时保留 `images/hero/`、`images/hero-mobile/` 等生成器输入；NKNK 原图已移出仓库和 Git 历史，放在 `NKNK_SOURCE_DIR`（默认 `../inabakumori-assets-src/NKNK`），不要再提交进仓库。

## 内部模块

| 模块 | 职责 |
| --- | --- |
| `build-site.mjs` / `check-build.mjs` | 构建白名单与发布产物门禁 |
| `render-creator-updates.mjs` / `render-x-posts.mjs` | 转义并预渲染作品、帖子和分页；X 渲染器每次构建创建一个独立快照，复用排序、校验和正文 HTML |
| `x-posts-data.mjs` | 帖子归档规范化、分片完整性与导入事务 |
| `safe-fs.mjs` / `net-guards.mjs` | 仓库真实路径检查、生产网络策略 |
| `check-changelog-table.mjs` / `github-run-request.mjs` | 上线表覆盖校验、有界网络请求与缓存 |
| `static-server.mjs` | 源码及产物预览的公开路径白名单 |
| `auth-src.js` | 认证客户端源码；`js/auth.js` 由构建生成 |
| `tests/` | 构建、前后端、安全、数据与维护工具的回归测试 |
