# 安全与运维现状（唯一当前参考）

更新：2026-10-11。本文只记录**当前**状态和操作清单；审查过程、证据和历史结论见 [history/2026-10-11-security-audits.md](history/2026-10-11-security-audits.md) 与 [history/2026-10-11-deployment-review.md](history/2026-10-11-deployment-review.md)。如何报告漏洞见根目录 [SECURITY.md](../SECURITY.md)。

## 当前状态

- 前端：`https://osagechan.top/`（GitHub Pages，只发布 `dist/` 白名单产物）；旧地址 `9178osage.github.io/inabakumori-site/` 301 到新域名。
- 后端：`https://inabakumori-site-production.up.railway.app`（Railway，根目录 `/backend`，单实例，SQLite 在持久化卷 `/data/comments.db`）。
- `/healthz` 只公开 `{ ok, version }`；`version` = 部署提交前 7 位（`RAILWAY_GIT_COMMIT_SHA`），用于确认重新部署。
- 三轮审查（2026-10-11）发现的问题均已修复上线：限流按真实访客 IP（`X-Real-IP`）计数；认证请求必须为 `application/json`（非 JSON 415，JSON 解压后 ≤20 KB）；生产会话 Cookie 使用 `__Host-station-` 前缀并强制 `Secure`、`Path=/`；CSP 含 Trusted Types、`frame-src/worker-src 'none'`；404 页独立 CSP；防嵌入脚本；GitHub Actions 固定 SHA，Dependabot 每周检查。
- 已有防护：SuperTokens 会话（header 传输）；会员只能删除自己的留言，管理接口另查权限；SQLite 参数化；服务端校验留言；前端只用 `textContent` 渲染；生产错误不返回堆栈；密码重置令牌放在 URL fragment 并立即清除。CORS 不是认证，保护操作始终依赖会话与权限。

## Railway 变量（只写名称，值不要进仓库或聊天）

| 变量 | 说明 |
| --- | --- |
| `NODE_ENV` | `production` |
| `WEBSITE_URL` | `https://osagechan.top`（CORS、SuperTokens websiteDomain、重置链接都由它决定） |
| `API_DOMAIN` | Railway 公网 API 地址 |
| `ADDITIONAL_WEBSITE_ORIGINS` | 可选，逗号分隔的裸 https origin（迁移过渡期用），不接受路径/通配符 |
| `TRUST_PROXY` | `1`（Railway 一层代理）；错误值会破坏限流 |
| `CLIENT_IP_HEADER` | 可选，默认在 Railway 上使用 `X-Real-IP` |
| `COMMENTS_DB_PATH` | 可选，绝对路径且须位于 Railway 卷内；默认为卷挂载目录下的 `comments.db`（当前 `/data/comments.db`） |
| `SUPERTOKENS_CONNECTION_URI` / `SUPERTOKENS_API_KEY` | SuperTokens Core |
| `ADMIN_USER_IDS` | **唯一**管理员来源：逗号分隔的 SuperTokens user ID。为空时启动日志警告；`ADMIN_EMAILS` 已移除且会被忽略 |
| `BACKUP_TOKEN` | ≥32 字符（如 `openssl rand -hex 32`）；未设置或过短时备份接口返回 404 |

## 管理员

- 只通过 `ADMIN_USER_IDS` 授权。不要恢复按邮箱授权，也不要根据他人提供的邮箱/ID 直接授予。
- 更换管理员：用可信方式查到 user ID → 修改 Railway 变量 → 重新部署 → 用 `/healthz` 确认版本。
- **管理员登录邮箱必须与公开联系邮箱不同**（页脚公开地址只用于收信，不作为登录标识），并且永远不要把管理员登录邮箱写进本仓库、文档、issue 或留言墙；`tools/tests/security.test.cjs` 有对应的守护测试。
- 换登录邮箱的最省事做法：在 SuperTokens Core Dashboard 里把**同一个用户**的 email 改成私密邮箱。授权按 user ID 计算，因此 `ADMIN_USER_IDS` 与代码都不用动；改完请一并轮换密码、撤销其他设备的会话，并确认旧地址已无法登录。

## 备份与例行检查

- 远程快照：`GET /api/admin/backup`，`Authorization: Bearer <BACKUP_TOKEN>`；每 IP 每小时 5 次、无 CORS、`no-store`，日志不记录令牌。返回 `comments-YYYYMMDD.db`。
- 备份脚本：运行在维护者自己的机器上，令牌保存在该机器的私有存储中（仅所有者可读），每次下载后校验 SQLite 文件头与大小，失败时非零退出。具体路径与运行方式记录在私有运维手册，不放入公开仓库。
- 本机/卷内快照：`npm --prefix backend run backup`（见 [OPTIMIZATION.md](OPTIMIZATION.md#数据库备份)）。
- 快照含全部留言与会员 user ID（无邮箱、密码、令牌、IP），按私密数据保管。令牌泄露时在 Railway 换新值并重新部署。
- 例行：每次推送后看 `Verify website` / `Publish public site` 是否成功、`/healthz` 的 `version`；定期 `npm audit`（根目录与 `backend`）并处理 Dependabot PR；定期恢复演练一次备份。

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

- 限流计数在单进程内存中，SQLite 单写入：Railway 必须保持 **1 个副本**；不防分布式 DDoS。扩容前需共享限流存储与数据库方案。
- 应用只经 Railway 公网 HTTP 入口访问；增加 TCP Proxy、自建代理或私网调用者时需重新核实 `X-Real-IP` 的信任边界。
- SuperTokens 默认允许已撤销的 access token 有效至到期。
- GitHub、Railway、SuperTokens 与 DNS 服务商账号都应开启两步验证；能推 `main`、改 Railway 变量或改 DNS 的人等同网站管理员。
- 管理员账号应使用长随机密码，并建议与公开联系方式分开。

## 验证

`npm run check`（测试、后端语法、生产构建、公开产物检查）与 `npm run test:integration`（临时数据库与本机服务，不触碰生产）。回归测试见 `tools/tests/security.test.cjs` 等。
