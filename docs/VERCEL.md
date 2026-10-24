# 将登录与留言后端迁往 Vercel

当前前端由 GitHub Pages 发布，生产 API 已切换到 `https://inabakumori-backend.vercel.app`。Vercel 只运行 `backend/` 中的 Express API；留言和共享限流计数保存在独立 Neon PostgreSQL，身份、密码和会员 user ID 继续使用原 SuperTokens Core。最终 SQLite 快照的 13 条留言已逐字段核对，保留原 ID、会员归属和历史 ID 序列。原 Railway 服务连接同一 PostgreSQL 并核验后已停止，旧 SQLite 卷和私密快照保留用于恢复演练。

下文保留迁移、预验证与回退步骤。后续部署仍须核对实际平台部署和线上内容，不能把源码适配或 Git 推送等同于生产发布。

Vercel 支持直接识别 `server.mjs` 导出的 Express 应用，项目根目录应为 `backend`。不要添加旧式 `api/` 包装或覆盖路由的 rewrites。[Express 部署说明](https://vercel.com/docs/frameworks/backend/express)

## 账号、项目与数据库

操作前需要能够登录目标 Vercel 账号、关联本站 GitHub 仓库，并管理 PostgreSQL 和原 Railway 服务。若 Vercel 显示登录页面，先完成账号登录与仓库授权；此时不能把本地适配或 GitHub 推送称作 Vercel 已部署。

在 Vercel 导入现有仓库并配置：

| 项目设置 | 值 |
| --- | --- |
| Production Branch | `main` |
| Root Directory | `backend` |
| Framework Preset | `Express` |
| Node.js Version | `24.x` |
| Install Command | 默认 npm 安装流程，使用 `backend/package-lock.json` |
| Build Command / Output Directory | 使用 Express 默认值，不运行根目录的静态网站构建 |

Vercel 只提供 Node 主版本选择，次版本和补丁由平台更新；上线时还须核对函数初始化日志中的实际 `process.version`，不能只看构建版本或 `engines`。本地与 CI 仍按仓库规定使用 Node 24.22.1。[Node 版本说明](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

本次切换时函数实际为 `v24.21.0`，尚未达到仓库的 24.22.1 安全基线。Vercel 公告说明托管运行时补丁仍在部署，自动 WAF 仅缓解已知入站攻击，不覆盖函数获取的上游响应，也不替代补丁。本站另外以 `inflate: false` 拒绝压缩请求体（415），阻止访客输入进入 Node Brotli 解码器；普通浏览器登录和留言均发送未压缩 JSON。此措施不等同完整运行时修复，后续仍须用实际函数日志确认平台补丁落地。[Vercel 安全公告](https://vercel.com/kb/bulletin/node-js-security-advisory)

使用托管 PostgreSQL，并让数据库与函数区域尽量接近。可由 Vercel Marketplace 关联数据库，使用适合函数并发的连接池地址；应用读取的变量名必须为 `DATABASE_URL`，不能仅因集成注入了其他名称就认为已配置。Preview 使用独立数据库或独立分支，避免预览部署写入生产。[Marketplace 数据库与连接池说明](https://vercel.com/docs/marketplace-storage)

Vercel 的本地文件系统不能持久保存留言；不得把 Railway 的 `comments.db` 上传进仓库、构建包或 `/tmp` 后当生产数据库使用。未设置 `DATABASE_URL` 的 Vercel 实例会拒绝启动。[Vercel 的 SQLite 限制](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)

## 环境变量

值只在平台的私密变量管理界面和维护者的私密环境中设置，不复制到提交、终端日志或聊天中。先区分 Production 与 Preview 的作用范围。

| 变量 | Vercel 要求 |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL 连接池地址，按数据库提供商要求启用 TLS；不关闭证书验证 |
| `API_DOMAIN` | 本项目实际可访问的 HTTPS API 域名，只填 origin |
| `WEBSITE_URL` | 现有前端 `https://osagechan.top` |
| `ADDITIONAL_WEBSITE_ORIGINS` | 仅按需填明确的受信前端 origin，逗号分隔；不使用通配符 |
| `SUPERTOKENS_CONNECTION_URI` / `SUPERTOKENS_API_KEY` | 沿用现有 SuperTokens Core 的连接配置 |
| `ADMIN_USER_IDS` | 沿用现有管理员的稳定 user ID，不用邮箱代替 |
| `BACKUP_TOKEN` | 如需受保护快照下载，设置至少 32 字符的随机令牌 |
| `COMMENTS_READ_ONLY` | 仅精确值 `1` 暂停所有留言 `POST` / `DELETE` 并返回 `503 COMMENTS_READ_ONLY`，用于最终备份维护窗口；设置或取消后重新部署 |
| `TRUST_PROXY` / `CLIENT_IP_HEADER` | 通常留空，使用 Vercel 平台提供并覆盖的访客 IP 头；增加自建代理时重新核对信任链 |

`VERCEL`、`VERCEL_GIT_COMMIT_SHA` 由平台提供，不把旧的 `RAILWAY_*` 变量复制过去。Vercel 不使用 `COMMENTS_DB_PATH`。所有生产实例必须连接同一个 PostgreSQL；留言写入与去重在数据库事务内完成，限流计数存入 PostgreSQL 的共享表。不能回到内存限流或为每个实例分配单独的数据库。

SuperTokens Core 在本次迁移中保留，不创建新 Core、不重新注册已有用户。迁移脚本只处理留言，保留 `user_id` 以维持所有权和管理员授权。API 域名改变后，浏览器可能需要重新登录；用实际账号核对登录、刷新会话、退出和密码重置链接。

## SQLite 备份导入

先用合成数据和隔离的 PostgreSQL 完成部署及恢复演练，再处理生产数据。SQLite 备份含留言正文和会员 user ID，按私密数据保存；使用原有一致性备份工具或受保护备份接口，不在服务运行时只复制 `.db` 文件而忽略 WAL。保留原始备份并限制文件权限。

迁移命令从仓库根目录运行。以下路径为占位示例，替换为维护者私有备份的实际路径；`DATABASE_URL` 应事先通过私密方式装入进程环境，不把连接串写在命令参数中。

```sh
node backend/migrate-comments.mjs --source /private/backup/comments.db
```

默认只读检查 SQLite 完整性、表结构和字段，输出会员与游客条数，不连接 PostgreSQL。也可显式加 `--dry-run`。检查成功后，确认目标数据库是本次生产迁移的专用数据库，再执行：

```sh
node backend/migrate-comments.mjs --source /private/backup/comments.db --apply
```

`--apply` 会初始化目标表，在事务中锁定留言表并拒绝非空目标，逐条保留 ID、昵称、正文、`user_id`、游客标记、创建时间和过期时间，包括备份中尚存的已过期游客留言。导入后逐字段核对全部记录，再按 SQLite 的历史 ID 序列高水位推进 PostgreSQL 序列；即使最高 ID 的留言或全部留言已删除，也不会重复使用曾经分配的 ID。任何插入或核对失败都会回滚留言导入，不提供覆盖、清空或去重合并开关；先查明失败原因，勿为重试而随意删除生产表。

命令成功只说明这一份快照已导入，不能证明备份生成后旧服务没有新写入。正式迁移必须使用下节的维护窗口，避免丢失最后几条留言或删除操作。每次运行只输出条数和固定错误信息，数据库提供商的详细诊断留在私密运维环境。

## 切换顺序

1. 保持原 Railway 服务与卷可恢复，记录当前正常提交、旧 API 地址、变量名称和备份位置。在独立 Preview 数据库上验证 Vercel 构建、`/healthz` 和数据库连接，预演导入与恢复。
2. 安排维护窗口，先让原 Railway 服务部署包含维护开关的兼容版本，再设置 `COMMENTS_READ_ONLY=1` 并重新部署。等待所有旧实例停止后，实际调用旧 API 的留言发布、会员删除和管理员删除路径，逐一确认均返回 `503`、`COMMENTS_READ_ONLY` 和 `Retry-After: 300`；同时确认读取、`/healthz`、认证与受保护备份仍可用。只隐藏前端按钮不能阻止直接调用。确认原服务不再写入后，生成最后一份 SQLite 一致性备份并离线检查。
3. 将最终快照 dry-run 后导入空的生产 PostgreSQL。保留原 SQLite 卷和备份。将保留的 Railway 后端设置为同一 `DATABASE_URL`，同时确保 Vercel 连接的也是该数据库。先保持两边 `COMMENTS_READ_ONLY=1` 部署并核对数据与健康状态，再取消两边的冻结变量并重新部署、验证恢复写入；这样切换期间两个地址共享同一份数据，不再各写一份数据库。
4. 部署 Vercel Production，确认对应 Git 提交、构建与函数初始化日志中的实际 Node 版本，以及 `/healthz` 返回的提交前缀。使用实际前端 origin 检查 CORS 和预检；在受控环境核对留言读取、游客发布、会员归属、删除权限、管理员接口、登录与会话刷新。确认多个实例共享限流、过期行为正确，备份可导出且恢复可用。测试留言及时清理。
5. 以上预验证全部通过后，再把 `js/config.js` 的生产 `apiDomain`、页面 CSP 的 `connect-src` 和相应构建校验、测试一并改为已经验证的 Vercel API origin。不要提前填写猜测的项目域名；不扩大 CSP 为通配符。
6. 按[站长手册](MAINTAINER.md)运行四项提交门禁，提交并推送 `main`，核对 GitHub Pages 发布和线上页面实际加载的新 API 地址。用线上页面再次验证登录、留言、删除和控制台 CSP/CORS 错误，记录实际检查的提交范围及部署结果。
7. Vercel、Pages、生产数据与回退方案全部确认后，再决定停用 Railway。停用前确认数据库已独立于待移除的 Railway 资源，保存最后备份和恢复记录；不要连同仍被 Vercel 使用的数据库一起删除。完成部署验证后按项目约定同步并检查本地文本副本。

## 回退与后续备份

前端切换前发现故障，保持原 API 地址，修复 Vercel 后重做预验证。当前 Railway 回退服务已停止；若切换后需要恢复该入口，先重新启动兼容后端，确认其 `DATABASE_URL` 仍连接当前 PostgreSQL，并验证健康状态、读取、写入和 CORS。以上核对通过后，再把前端配置与 CSP 改为已验证的旧地址，重新部署前端并核验线上行为。

一旦 PostgreSQL 已接收新留言或删除，不能只把后端切回旧 SQLite 文件或回退到只支持 SQLite 的历史代码，否则会丢失新数据。需要恢复数据库时先暂停所有写入、备份当前 PostgreSQL，并在隔离环境演练、核对时间点与增量，再制定数据恢复方案。Vercel 的代码回滚不会回滚数据库。

Neon Free 的恢复历史最多 6 小时、手动快照限 1 个，不包含定时备份；不能把免费数据库接入等同持续异地备份已建立。[Neon 方案说明](https://neon.com/docs/introduction/plans)

独立快照使用 `python3 tools/remote-backup.py /private/path/backup-config.json`。私有 JSON 包含 `url`（当前生产 `/api/admin/backup` 的完整 HTTPS 地址）、`token`、`directory`（绝对路径）及可选的 `retention_days`（默认 30）；配置与目录仅允许所有者访问，不放入 Git。工具拒绝重定向，限制下载体积，校验 SQLite 完整性、留言结构与 ID 序列后才保存，失败不轮换旧备份；成功后只清理其自有命名的过期快照。它不包含 SuperTokens 的身份、密码或会话备份。

维护者机器使用本工具的私有安装副本每日备份；需要机器开机、用户登录且联网，不能宣称全天候云备份。应用快照导出为兼容的 SQLite 文件，便于离线核对与恢复演练；导出文件同样含私密留言及 user ID，不作为公开构建产物。成功备份响应的 `X-Backend-Node-Version` 仅向持有备份令牌的请求提供实际运行时版本；客户端日志保留版本证据，便于确认平台补丁。定期检查备份新鲜度、恢复可用性、数据库连接量和共享限流表的清理情况。
