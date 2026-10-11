# Security notes / 安全审查记录（2026-10-11）

> 归档：本文原为根目录 `SECURITY_NOTES.md`，2026-10-11 整理文档时原文移入 `docs/history/`，内容未改，仅更新链接。当前状态与运维清单以 [docs/SECURITY.md](../SECURITY.md) 为准。

## 第三轮审查：基线 `3386803`，本轮补丁待发布

本轮通读核心后端、备份、前端及构建/工作流，使用安装的 Express 和 SuperTokens SDK 在本机复现边界问题，并对线上做低频只读检查。没有读取生产 `.env`、登录真实账号、向线上发送超大/压缩请求、发表或删除留言。以下结果取代历史记录中“header 模式无 Cookie”“所有请求均受 20 KB 限制”的判断。

| 优先级 | 已复现的问题 | 本轮修复 |
| --- | --- | --- |
| P1（有条件的凭据泄漏） | SuperTokens header auth 实际将 access/refresh token 存入 JavaScript Cookie；默认非 iframe 写入缺少 `Secure`。Pages 未发送 HSTS，浏览器没有有效 HSTS 升级时，HTTP 首跳会在 301 之前发送这些 Cookie | 通过公开 `cookieHandler` 扩展，把生产会话 Cookie 放入独立的 `__Host-station-` 名称空间，强制 `Secure`、`Path=/` 且无 Domain；清理并忽略旧名称，用户重新登录一次；生成新的 `js/auth.js` |
| P1（未认证拒绝服务） | `express.json` 只处理 JSON Content-Type。认证 POST 使用 `text/plain` 或缺少 Content-Type 时，SDK 自行读取请求体，没有应用字节上限。合成的 2 MB JSON 和仅 2,103 字节 gzip 均被原 SDK 解析出 2 MB 字段 | 在所有请求体解析器之前要求带 body 的请求使用 `application/json`；非 JSON/缺类型返回 415，合法 JSON 解压后仍受 20 KB 上限；覆盖 chunked。无 body 的 refresh/signout 继续兼容 |

不支持的字符集/压缩格式统一返回 415。IP 信任注释也已更正：限流头依赖 Railway 可信公共 HTTP ingress，私网/TCP/新增代理路径必须重新核实；IP 头从来不参与用户身份或管理员授权。

**验证**：根目录和 `backend` 的联网 `npm audit --json` 均返回 0 个已知漏洞。新增测试直接使用当前 SDK 的令牌 Cookie writer/reader，以及 Express + SDK parser，覆盖凭据写入/删除、旧 Cookie 隔离、非 JSON、缺类型、chunked、gzip 解压上限。集成测试还验证实际中间件次序、415/413、无 body 刷新 401、留言/备份/CORS/限流和安全构建白名单。漏洞复现仅使用合成数据。`npm audit` 不覆盖 Node 运行时或平台配置；本机检查使用 Node `24.19.0`，Railway 实际运行时补丁版本未读取，仍需保持受支持 24.x 分支的更新。

最终验证结果：`npm run check` **113/113 测试通过**，后端语法检查、生产构建和公开资源检查通过；`npm run test:integration` 通过；`git diff --check` 通过。前端测试还通过真实 `SuperTokens.init`/`Session.init` 和 fetch 拦截器验证响应头令牌保存、会话元数据、识别登录及退出清理（全部使用 mock 网络响应）。两个共享 Cookie jar 的 handler 与旧 bundle 写入/删除测试确认新名称不会被旧快照覆盖或复活。独立代码复核通过。

**审计结论的边界**：在本次检查的应用路径中没有发现可复现的命令执行、SQL 注入、SSRF 或会员/管理员越权；这不等于已经证明服务器、平台或账号不存在任何漏洞。公开 API 可以被任意客户端调用，TLS 保障链路，服务端会话和权限才决定调用者能做什么。无须增加可从公开前端复制的“加密密钥”作为认证。

**上线与运维**：本轮补丁已在 `3386803` 之后提交上线（见 git log：后端请求体边界、前端 Secure 会话 Cookie）。前后端都要发布；发布后关闭旧标签页、重新打开 HTTPS 网站并登录一次。新名称不会读取或复制旧 token，避免旧标签的写入、删除与新会话冲突；本机 HTTP 开发继续使用原 SDK 存储。清理 Cookie 不能撤销此前可能泄漏的令牌；若怀疑已经泄漏，应在认证服务撤销相关会话。GitHub `main` 当前没有分支保护或 rulesets，应配置 PR/必过检查并调整现有自动更新的直推流程。Pages 无 HSTS 仍是托管边界。**2026-10-11 已完成**：GitHub 账户 Settings → Pages 中 `osagechan.top` 显示 **Verified**；仓库 Pages 发布源已改为 **GitHub Actions**（不再同时从 `main` 分支直接发布原始仓库，消除两个部署器竞争）。详细现网证据和 CI/DNS 状态见 [部署与公网复核](2026-10-11-deployment-review.md)。默认 SuperTokens 撤销行为允许旧 access token 有效至到期；如需要敏感操作立即检查撤销状态，可单独设计并验证 `checkDatabase`，本轮未更改该行为。

参考：[SuperTokens header auth 存储说明](https://supertokens.com/docs/post-authentication/session-management/switch-between-cookies-and-header-authentication)、[MDN Cookie 安全](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies)、[SuperTokens access token 撤销说明](https://supertokens.com/docs/post-authentication/session-management/advanced-workflows/access-token-blacklisting)。以下保留前两轮历史记录，涉及现网状态应以上述本轮记录及部署报告为准。

审查范围：Brakeintime 提出的两类问题。① 后端能否被远程执行代码、读写服务器文件或拿到主机权限（RCE / host access）；② 前后端之间能否被冒充或中间人攻击（spoofing / MITM）。
方法：通读 `backend/*.mjs`、前端 JS/CSP、CI；对线上 Railway API 做只读探测（未登录、未发帖、未删除任何内容）；`npm audit`。

## 结论速览

| 严重度 | 问题 | 状态 |
|---|---|---|
| 无高危 | 未发现 RCE、任意文件读写、SSRF、SQL 注入、原型污染或越权删除路径 | — |
| 中 | 静态站可被第三方网站 iframe 嵌入（GitHub Pages 无法发送 `frame-ancestors`），存在点击劫持风险 | 已修：`js/preferences.js` 首个脚本内的防嵌入保护 |
| 中（运维） | 自定义域名 `osagechan.top` 无 HSTS（GitHub Pages 对自定义域名不发 HSTS，`.top` 不在预加载列表），首次以 `http://` 访问理论上可被 SSL-strip | 残余风险，见下 |
| 低 | 迁移域名后 CORS 只允许单一来源，无法在过渡期临时放行旧来源 | 已修：可选 `ADDITIONAL_WEBSITE_ORIGINS`（只接受裸 https origin） |
| 低 | `404.html` 的返回链接在根域名下用相对路径 `./`，深层 404 会跳错 | 已修为 `/` |
| 低 | 管理员可按 `ADMIN_EMAILS` 授权（注册时填写邮箱不能证明拥有该邮箱） | 已修：彻底移除邮箱授权，只认 `ADMIN_USER_IDS`；为空时启动日志警告 |
| 低 | `/healthz` 公开运行环境、服务名与运行时长 | 已修：只返回 `{ ok, version }`（`version` = 部署提交前 7 位，非敏感，用于确认重新部署） |

## ① RCE / 主机访问

- 后端业务代码中**没有** `child_process`、`eval`、`new Function`、动态 `import()`、SQLite 扩展加载或静态文件服务。数据库路径来自环境变量；备份接口认证后会生成、读取并删除固定临时目录里的 SQLite 快照。没有发现用户输入可控制该文件路径或出站请求地址的路径；认证 SDK 本身会访问配置的 Core/邮件服务。
- SQL 全部为预编译参数化语句；`node:sqlite` 默认禁用扩展加载。
- 输入：`express.json` 20 KB 上限、`strict`；`query parser` 为 `simple`（无嵌套对象 → 无 `qs` 原型污染）；留言字段类型/长度/控制字符/双向文本字符均在服务端校验；ID 用严格正则解析。
- 错误：生产环境只返回 `code` 与 `requestId`，不返回堆栈；`x-powered-by` 已关闭。
- 线上探测：`/.env`、`/package.json`、`/comments.db`、`..%2f` 路径穿越、`TRACE`/`PUT`、SuperTokens dashboard 路径均返回 JSON 404；伪造/无签名 JWT（`alg: none`）访问管理接口返回 401。`/auth/jwt/jwks.json` 只暴露公钥，属正常。
- 依赖：根目录与 `backend` 的 `npm audit` 均为 0 漏洞（此前已修复 `proxy-addr` 严重漏洞）。CI 中第三方 Action 已固定到 commit SHA，工作流默认只读权限。
- 主机层面：服务运行在 Railway 容器内，没有 SSH/调试端口由本代码暴露。真正的主机风险在于**账号**：GitHub、Railway、SuperTokens、DNSPod 账号请开启两步验证；任何能推送 `main` 或修改 Railway 环境变量的人都等同于拥有服务器。

## ② 冒充 / 中间人

- **传输**：API 位于 `*.up.railway.app`，`.app` 整个顶级域在浏览器 HSTS 预加载列表中 → 浏览器只会用 HTTPS 连接 API；后端也发送 HSTS。前端 `osagechan.top` 使用 Let's Encrypt 证书，GitHub Pages 已开启 Enforce HTTPS（`http://` → 301 `https://`）。旧地址 `9178osage.github.io/inabakumori-site/` 301 跳到新域名。
- **API 地址不可被篡改**：`js/config.js` 写死 HTTPS 的 Railway 地址，不读取 URL 参数；CSP `connect-src` 只允许自身与该 API，生产构建会去掉 localhost（`check-build` 强制）。
- **CSRF / 冒充用户**：会话令牌通过 `Authorization` 请求头传输（SuperTokens header 模式），API 不使用自动携带的 Cookie 授权。前端 SDK 仍使用 JavaScript Cookie 存储令牌，其传输安全见第三轮修复。所有删除与管理接口都在服务端校验会话；会员只能删除自己的留言（SQL 条件含 `user_id`）；管理接口额外检查管理员身份。CORS 只是浏览器读响应的限制，不是认证——伪造 `Origin` 仍然拿不到受保护数据（集成测试覆盖）。
- **游客**：游客只能发帖（每 IP 每小时 3 条、内容过滤、去重），不能删除；不存在可被猜测的“游客删除令牌”。
- **XSS（令牌被盗的主要途径）**：所有服务端数据以 `textContent` 渲染，前端无 `innerHTML`/`eval`；CSP 禁止内联脚本与 `unsafe-eval`。header 模式下令牌存于前端可读存储，因此保持“无 HTML 注入 + 严格 CSP”是关键不变量（`tools/tests/security.test.cjs` 守护）。
- **点击劫持**：已加防嵌入脚本（被第三方 frame 时隐藏页面并尝试跳出）。

## 备份下载接口（2026-10-11）

- `GET /api/admin/backup`：返回一致性 SQLite 快照（`node:sqlite` `backup()` → 临时目录 → `quick_check` → 流式返回 → 删除临时文件），`application/octet-stream`，文件名 `comments-YYYYMMDD.db`。
- 认证：`Authorization: Bearer <BACKUP_TOKEN>`，SHA-256 后用 `crypto.timingSafeEqual` 比较。`BACKUP_TOKEN` 未设置或少于 32 字符时接口返回 404（与不存在的路径相同）。
- 每 IP 每小时 5 次；不发送任何 CORS 头（浏览器页面无法读取，只供服务器/脚本使用）；`Cache-Control: no-store`；日志只记录 requestId、IP、大小，从不记录令牌。
- 令牌只放在 Railway 变量和备份机器的权限 600 文件里，切勿提交到仓库或贴进聊天。泄露时在 Railway 换一个新值并重新部署即可作废旧令牌。
- 快照包含全部留言（含会员 `user_id`），备份文件需按私密数据保管。

## 第二轮全面审查（2026-10-11 凌晨）

| 严重度 | 发现 | 证据 | 处理 |
|---|---|---|---|
| 中 | 限流按 Railway 边缘节点 IP 计数而不是访客 IP：`TRUST_PROXY=1` 时 `req.ip` 是共享的边缘/CDN 跳点，所有访客挤在少数几个桶里，一个人就能把全站游客发帖（3 条/小时）和登录（20 次/15 分钟）额度用光 | 从两个不同公网 IP（Mac 与 box）请求，`RateLimit` 计数连续递减且共用 reset 时间 | 已修：所有 IP 限流改用 Railway 边缘覆写、客户端无法伪造的 `X-Real-IP`（在 Railway 上默认启用，`CLIENT_IP_HEADER` 可覆盖，非法值回退）；集成测试验证不同访客独立计数 |
| 轻微 | 备份下载若客户端在快照生成期间断开，临时文件可能残留 | 代码审查 | 已修：改用 `stream.pipeline`，无论成功/断开都删除临时目录 |
| 轻微 | CSP 未启用 Trusted Types；`404.html` 没有 CSP | 代码审查 | 已修：主站加 `require-trusted-types-for 'script'; trusted-types 'none'`、`frame-src/worker-src 'none'`（无头浏览器验证无违规）；404 页加 `default-src 'none'` + 样式哈希 |
| 轻微 | GitHub 官方 Actions 用可变标签（`@v4` 等）；无 Dependabot | 工作流审查 | 已修：全部固定到 commit SHA；新增 `.github/dependabot.yml`（npm 根目录、`backend`、github-actions，每周） |
| 轻微 | 站长联系邮箱即管理员登录邮箱（公开在页面 `mailto:`） | 页面源码 | 未改（属内容决定）：建议换一个专用联系邮箱，管理员账号使用长随机密码 |
| 信息 | ReDoS：链接/电话/推广正则在 2 万字符时呈二次方增长（~0.7 s），但服务器先做 500/30 字长度校验，500 字最坏 < 3 ms | 本地基准 | 加回归测试守护“先校验长度” |

第二轮当时的验证记录：gitleaks 扫描 118 个提交无密钥；未提交 `.env`/数据库；当时 npm audit 均 0；Pages 不暴露 `.git`、后端源码、source map、文档；`PUT/PATCH/TRACE` 返回 404，`HEAD` 备份接口返回 405；CORS 拒绝 `null`、相似域名、`http://` 来源；当时 TLS 协议检查为 1.2/1.3；评论删除带 `user_id` 条件；分页每页固定 20/50 条；请求头 15 s、请求 30 s 超时。第三轮纠正：header 会话模式仍有前端存储 Cookie；原 20 KB 上限未覆盖 SDK 非 JSON 备用解析器。本轮没有重跑完整历史 gitleaks，也没有从公网证明 Railway 全部内部端口配置。

隐私：本站数据库只保存昵称、留言、时间、会员的 SuperTokens user ID；**不保存 IP 或邮箱**。邮箱与密码哈希在 SuperTokens。游客留言 182 天后自动删除。Railway 日志会记录请求 IP（平台行为）；备份接口日志记录 IP 但不记录令牌。备份文件含 user ID、无密码/令牌/邮箱。

## 残余风险

1. **HSTS（osagechan.top）**：GitHub Pages 不能为自定义域名发送 HSTS 头，也就无法加入 HSTS 预加载。首次手动输入 `http://` 且网络被控制时理论上可被降级。彻底解决需在前面加 Cloudflare（见清单 E）。
2. **单实例限制（有意为之）**：限流计数保存在单个 Node 进程内存中，重启即清零，多副本之间不共享；SQLite 只允许一个写入实例。因此 Railway 服务必须保持 **1 个副本**，不要开启水平扩容。这些限流防的是普通刷帖/撞库，不防分布式 DDoS（由 Railway 边缘兜底）。如需扩容，必须先换成共享限流存储（如 Redis）和多实例数据库。
3. **账号安全**：GitHub、Railway、SuperTokens、DNSPod 账号务必开启两步验证——能推送 `main` 或改 Railway 变量的人等同于拥有服务器。

## 待办清单：DNS / GitHub（需账号持有人操作）

第三轮线上状态（2026-10-11 检查）：A 为 `185.199.108.153`、`185.199.109.153`；AAAA 为 `2606:50c0:8000::153`、`2606:50c0:8001::153`；CAA 与 GitHub challenge TXT 已存在；`www` 为 NXDOMAIN；`http://` 已 301 到 `https://`；无 HSTS 头。下表中的已有/新增标签来自此前清单，实际状态以本轮部署报告为准。

**A. DNSPod → osagechan.top 记录**（主机记录 `@`，TTL 600）

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| A | @ | 185.199.108.153（已有） |
| A | @ | 185.199.109.153（已有） |
| A | @ | 185.199.110.153（新增） |
| A | @ | 185.199.111.153（新增） |
| AAAA | @ | 2606:50c0:8000::153 |
| AAAA | @ | 2606:50c0:8001::153 |
| AAAA | @ | 2606:50c0:8002::153 |
| AAAA | @ | 2606:50c0:8003::153 |
| CAA | @ | `0 issue "letsencrypt.org"` |
| CAA | @ | `0 iodef "mailto:<你的邮箱>"`（可选，证书违规签发时通知） |

**B. www（可选）**：`CNAME`，主机记录 `www`，记录值 `9178osage.github.io`。GitHub 会把 `www.osagechan.top` 自动跳到 `osagechan.top`。

**C. GitHub 域名验证（防止域名被他人 Pages 接管）**：GitHub 头像 → Settings → Pages → Add a domain → 输入 `osagechan.top` → GitHub 显示一条 TXT。在 DNSPod 添加：类型 `TXT`，主机记录 `_github-pages-challenge-9178osage`，记录值为 GitHub 给出的字符串 → 回到 GitHub 点 Verify。**状态：2026-10-11 已 Verified。**

**D. Enforce HTTPS / 发布源**：仓库 Settings → Pages → Custom domain 为 `osagechan.top`，勾选 **Enforce HTTPS**（已确认生效）；Build and deployment → Source 为 **GitHub Actions**（2026-10-11 已设置）。改动 DNS 后若证书重新签发，确认该勾选仍在。

**E. HSTS（可选架构调整）**：采用能配置 HTTPS 响应头的托管/CDN 后再开启 HSTS。若使用 Cloudflare，应保持 **Full (strict)**、验证 Pages 原站证书和续期方案，并盘点全部子域名后再决定 `includeSubDomains`/preload。不要通过放宽证书验证回避续期错误；本轮未实施 DNS/CDN 迁移。

## 回归保护

`tools/tests/security.test.cjs`：禁止后端出现命令执行/动态代码/扩展加载/文件读写/SSRF 原语；所有写操作路由必须要求会话、管理路由必须 `requireAdmin`；header 令牌模式；`ADDITIONAL_WEBSITE_ORIGINS` 校验；前端固定 API、无 HTML 注入、CSP 无 `unsafe-*`；防嵌入保护；管理员只认 `ADMIN_USER_IDS`；`/healthz` 只返回 `ok`/`version`。`tools/integration.mjs` 额外验证放行的旧来源仍需会话、健康检查返回内容最小化。

---

## 附：整理前的 `docs/SECURITY.md` 原文（2026-10-11 归档）

### 后端安全与运维（原文）

#### 2026-10-11 第三轮补丁

- 认证 SDK 的非 JSON 备用解析器能绕过 Express 的 20 KB 请求体限制。本轮在所有解析器之前要求带 body 的请求使用 `application/json`；非 JSON/缺类型返回 415，JSON（含 gzip 与 chunked）仍受解压后 20 KB 上限。无 body 的会话操作继续有效。
- Header auth 的前端令牌实际存于 JavaScript Cookie。本轮采用独立 `__Host-station-` 名称，强制 `Secure`、`Path=/`、无 Domain；清理并忽略旧 Cookie，不复制旧令牌。新 bundle 发布后需关闭旧标签页，重新打开 HTTPS 页面并登录一次。
- 完整测试、构建与隔离 HTTP 集成验证通过；联网依赖审计均为 0 个已知漏洞。复现与写操作只在本机隔离环境执行。
- 代码补丁尚未发布。细节与限制见根目录 `SECURITY_NOTES.md`，现网版本/DNS/CI/分支保护证据见 `docs/SECURITY_DEPLOYMENT_REVIEW_2026-10-11.md`。

#### 2026-10-10 加固

- 2026-10-11 起管理员只通过 Railway `ADMIN_USER_IDS`（SuperTokens 稳定 user ID，多个值用逗号分隔）授权；`ADMIN_EMAILS` 已移除，设置了也只会在启动日志里提示“已不再使用”。`ADMIN_USER_IDS` 为空时启动日志会警告。不要根据陌生人提供的邮箱或 ID 直接授予权限。
- `/healthz` 只公开 `{ ok, version }`。
- 可选备份接口 `GET /api/admin/backup`：需 Railway `BACKUP_TOKEN`（≥32 字符），以 `Authorization: Bearer` 调用；未设置时返回 404。详见 `SECURITY_NOTES.md`。完整审查与 DNS/GitHub 清单见根目录 `SECURITY_NOTES.md`。
- 新增每 IP 每分钟 180 次总请求限制，在 JSON 解析前执行，覆盖无效 JSON 和未知路径。登录、留言及删除操作仍有更严格的独立限制。
- DELETE 限流匹配忽略路径大小写，与 Express 路由行为一致。

#### 已有防护

- SuperTokens 验证登录会话；用户只能删除自己的会员留言，管理员接口另外检查权限。
- SQLite 使用参数化语句；留言类型、长度、控制字符与内容在服务器校验；前端以文本显示留言。
- JSON 请求体上限 20 KB，配置请求超时，生产错误不返回内部堆栈。
- 新域名 `https://osagechan.top` 已配置为 Railway 的 `WEBSITE_URL`。CORS 不是身份验证，客户端能伪造 Origin；保护操作仍必须通过会话及权限检查。
- 密码重置链接将令牌放在 URL fragment，前端读取后清除地址中的令牌。

#### 验证与边界

运行 `npm run check` 和 `npm run test:integration`。集成检查使用临时数据库和本机服务，不在生产留言墙发布测试内容。依赖可通过 `npm --prefix backend audit --omit=dev` 检查。

限流状态保存在单个进程内，重启会重置，不抵御分布式 DDoS。SQLite 与当前限流实现按单实例部署；扩容需要共享限流存储及数据库方案。持续监控 Railway 的错误、请求量、资源使用和费用，并保持数据库备份。管理员真实登录及邮件投递需要账号持有人参与验证。
