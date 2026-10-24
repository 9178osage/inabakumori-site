# 安全与运维现状（唯一当前参考）

更新：2026-10-23。本文只记录**当前**状态和操作清单；最新代码审查见 [2026-10-17 复核记录](history/2026-10-17-full-review.md)，此前审查证据见 [history/2026-10-11-security-audits.md](history/2026-10-11-security-audits.md) 与 [history/2026-10-11-deployment-review.md](history/2026-10-11-deployment-review.md)。如何报告漏洞见根目录 [SECURITY.md](../SECURITY.md)。

## 当前状态

- 前端：`https://osagechan.top/`（GitHub Pages，只发布 `dist/` 白名单产物）；旧地址 `9178osage.github.io/inabakumori-site/` 301 到新域名。
- 后端：`https://inabakumori-backend.vercel.app`（Vercel，项目 `inabakumori-backend`，根目录 `backend`，Express / Node 24.x）。留言和共享限流计数保存在独立 Neon 免费 PostgreSQL，Production 以外的部署没有连接该生产库。身份和管理员 user ID 沿用原 SuperTokens Core。
- 迁移时的最终 SQLite 快照已导入并逐字段核对：13 条留言（2 条会员、11 条游客），保留原 ID、所有权、时间和历史 ID 序列。原 Railway 卷和私密快照用于恢复演练；重新启用旧入口时，必须保持连接迁移后的 PostgreSQL，不能再启用旧 SQLite 写入。切换和回退步骤见 [迁移说明](VERCEL.md)。
- `/healthz` 只公开 `{ ok, version }`；`version` 为部署提交前 7 位，优先取 `VERCEL_GIT_COMMIT_SHA`，兼容 `RAILWAY_GIT_COMMIT_SHA`。
- 三轮审查（2026-10-11）发现的问题均已修复上线：限流按真实访客 IP 计数（当前 Vercel 使用平台覆盖的 `X-Forwarded-For`，Railway 使用 `X-Real-IP`）；认证请求必须为 `application/json`（非 JSON 415，JSON 解压后 ≤20 KB）；生产会话 Cookie 使用 `__Host-station-` 前缀并强制 `Secure`、`Path=/`；CSP 含 Trusted Types、`frame-src/worker-src 'none'`；404 页独立 CSP；防嵌入脚本；GitHub Actions 固定 SHA，Dependabot 每周检查。
- 已有防护：SuperTokens 会话（header 传输）；会员只能删除自己的留言，管理接口另查权限；数据库查询参数化；服务端校验留言；前端只用 `textContent` 渲染；生产错误不返回堆栈；密码重置令牌放在 URL fragment 并立即清除。CORS 不是认证，保护操作始终依赖会话与权限。
- 本地维护工具也按输入边界加固：链接检查器只访问公开 HTTP(S) 地址、逐跳检查重定向并固定到已验证的 DNS 答案；构建、图库生成、播放量更新拒绝符号链接输入/输出，防止访问或覆盖仓库外的文件。
- 2026-10-17 代码复核补齐：Unicode 行分隔符纳入留言换行限制；本地预览拒绝符号链接文件和目录，产物检查拒绝符号链接及非普通文件，防止白名单文件名掩盖私有内容。根目录及后端依赖在本次 `npm audit` 中均为 0 已知漏洞，不代表不存在未公开漏洞。

## 后端变量（只写名称，值不要进仓库或聊天）

| 变量 | 说明 |
| --- | --- |
| `NODE_ENV` | `production` |
| `WEBSITE_URL` | `https://osagechan.top`（CORS、SuperTokens websiteDomain、重置链接都由它决定） |
| `API_DOMAIN` | 当前后端部署的公网 HTTPS origin |
| `ADDITIONAL_WEBSITE_ORIGINS` | 可选，逗号分隔的裸 https origin（迁移过渡期用），不接受路径/通配符 |
| `TRUST_PROXY` | Railway 使用 `1`；Vercel 可省略，代码直接读取平台覆盖的 IP 头 |
| `CLIENT_IP_HEADER` | 可选，Railway 默认 `X-Real-IP`，Vercel 默认 `X-Forwarded-For`；仅接受单个有效 IP |
| `DATABASE_URL` | Vercel 必需的 PostgreSQL 连接串；Preview 必须使用独立数据库，不能复用生产 |
| `COMMENTS_READ_ONLY` | 正常为 `0`；迁移维护时设为 `1`，冻结留言发布、删除和过期清理，读取及受保护备份仍可用 |
| `COMMENTS_DB_PATH` | 仅供本地或旧 SQLite 模式；Vercel 不使用该路径 |
| `SUPERTOKENS_CONNECTION_URI` / `SUPERTOKENS_API_KEY` | SuperTokens Core |
| `ADMIN_USER_IDS` | **唯一**管理员来源：逗号分隔的 SuperTokens user ID。为空时启动日志警告；`ADMIN_EMAILS` 已移除且会被忽略 |
| `BACKUP_TOKEN` | ≥32 字符（如 `openssl rand -hex 32`）；未设置或过短时备份接口返回 404 |

## 管理员

- 只通过 `ADMIN_USER_IDS` 授权。不要恢复按邮箱授权，也不要根据他人提供的邮箱/ID 直接授予。
- 更换管理员：用可信方式查到 user ID → 修改 Vercel Production 变量 → 重新部署 → 用 `/healthz` 确认版本。
- **管理员登录邮箱应与公开联系邮箱不同**（目标）。**当前已接受偏差**：管理员仍用页脚公开地址登录，理由是站点体量小、管理员密码由密码管理器生成、≥20 位随机且全站唯一；若密码条件不再成立，应立即改邮箱。无论如何，不要把管理员登录邮箱另写进本仓库、文档、issue 或留言墙，也不要恢复按邮箱授权；`tools/tests/security.test.cjs` 有对应的守护测试。
- 换登录邮箱的最省事做法：在 SuperTokens Core Dashboard 里把**同一个用户**的 email 改成私密邮箱。授权按 user ID 计算，因此 `ADMIN_USER_IDS` 与代码都不用动；改完请一并轮换密码、撤销其他设备的会话，并确认旧地址已无法登录。

## 备份与例行检查

- 远程快照：`GET /api/admin/backup`，`Authorization: Bearer <BACKUP_TOKEN>`；每 IP 每小时 5 次、无 CORS、`no-store`，日志不记录令牌。返回 `comments-YYYYMMDD.db`。
- PostgreSQL 模式仍导出一致性 SQLite 留言快照，保留全部留言字段，不含共享限流计数。`npm --prefix backend run backup` 是 SQLite 本机备份入口；PostgreSQL 使用受保护快照接口和数据库提供商备份。
- 备份脚本：运行在维护者自己的机器上，令牌保存在该机器的私有存储中（仅所有者可读），每次下载后校验 SQLite 文件头与大小，失败时非零退出。具体路径与运行方式记录在私有运维手册，不放入公开仓库。
- 本机/卷内快照：`npm --prefix backend run backup`（见 [OPTIMIZATION.md](OPTIMIZATION.md#数据库备份)）。
- 快照含全部留言与会员 user ID（无邮箱、密码、令牌、IP），按私密数据保管。令牌泄露时在 Vercel Production 换新值并重新部署；如旧回退入口仍启用，同步轮换。
- 例行：每次推送后看 `Verify website` / `Publish public site` 是否成功、`/healthz` 的 `version`；定期 `npm audit`（根目录与 `backend`）并处理 Dependabot PR；定期恢复演练一次备份。
- 轮换管理员密码时，复核密码仍为 ≥20 位随机且全站唯一；若不满足，应由账号所有者重新评估已接受的风险。

简明操作说明见 [站长手册](MAINTAINER.md)。

## DNS / GitHub 状态

| 项目 | 状态 |
| --- | --- |
| A `@` | `185.199.108.153`、`185.199.109.153`（已配置；GitHub 另有 `.110`、`.111` 可选补全） |
| AAAA `@` | `2606:50c0:8000::153`、`2606:50c0:8001::153`（已配置；`8002`、`8003` 可选） |
| CAA `@` | `0 issue "letsencrypt.org"`（已配置） |
| TXT `_github-pages-challenge-9178osage` | 已配置；GitHub 账户 Settings → Pages 显示 **Verified** |
| `www` | 未配置（可选：CNAME → `9178osage.github.io`） |
| Pages 发布源 | **GitHub Actions**（不再同时从 `main` 分支发布） |
| Enforce HTTPS | 已开启（`http://` → 301 `https://`） |
| `main` 保护 | ruleset `protect-main`（active）：禁止删除、禁止 force push；仍允许直接推送 |
| HSTS（osagechan.top） | **待定**：GitHub Pages 不能为自定义域名发 HSTS。如需，前置 Cloudflare（Full (strict)，确认原站证书续期，盘点子域后再决定 `includeSubDomains`/preload） |

## 边界与残余风险

- SQLite 模式的限流计数仍在单进程内存中，Railway 必须保持 **1 个副本**。PostgreSQL 模式各限流器使用独立命名空间的共享原子计数，数据库不可用时拒绝请求，不回落到内存。留言去重、会员上限与插入在同一写事务内完成。不防分布式 DDoS。
- 应用只经部署平台公网 HTTP 入口访问；Vercel 信任平台覆盖的 `X-Forwarded-For`，Railway 信任 `X-Real-IP`。增加代理或私网调用者时需重新核实 IP 信任边界。
- SuperTokens 默认允许已撤销的 access token 有效至到期。
- GitHub、Vercel、Railway、SuperTokens 与 DNS 服务商账号都应开启两步验证；能推 `main`、改后端变量或改 DNS 的人等同网站管理员。
- 管理员账号应使用长随机密码，并建议与公开联系方式分开。

## 验证

`npm run check`（测试、后端语法、生产构建、公开产物检查）与 `npm run test:integration`（临时数据库与本机服务，不触碰生产）。回归测试见 `tools/tests/security.test.cjs` 等。

**本地检查请使用 Node 24.x**：`package.json` 的 `engines` 只是声明，未开启 `engine-strict`，所以 Node 22 也能装能跑；但 `node:sqlite` 等 API 在 22 与 24 之间有差异，用旧版本跑出来的结论不能直接对应 CI 与生产。CI 使用 Node 24。（若要让安装阶段直接拒绝，需要在确认 Railway 也运行 24.x 之后再开 `engine-strict=true`。）
