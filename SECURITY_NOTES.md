# Security notes / 安全审查记录（2026-10-11）

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
| 信息 | 管理员授权：`ADMIN_EMAILS` 现要求“已验证邮箱”，本站未开邮件验证 → 仅邮箱配置的管理员失效 | 设计如此，需配置 `ADMIN_USER_IDS` |

## ① RCE / 主机访问

- 后端代码中**没有** `child_process`、`eval`、`new Function`、动态 `import()`、SQLite 扩展加载、静态文件服务、请求可达的文件读写或对外 HTTP 请求（SSRF）。唯一的文件系统操作是启动时 `mkdirSync` 数据库目录，路径来自环境变量且生产环境强制位于 Railway Volume 内。
- SQL 全部为预编译参数化语句；`node:sqlite` 默认禁用扩展加载。
- 输入：`express.json` 20 KB 上限、`strict`；`query parser` 为 `simple`（无嵌套对象 → 无 `qs` 原型污染）；留言字段类型/长度/控制字符/双向文本字符均在服务端校验；ID 用严格正则解析。
- 错误：生产环境只返回 `code` 与 `requestId`，不返回堆栈；`x-powered-by` 已关闭。
- 线上探测：`/.env`、`/package.json`、`/comments.db`、`..%2f` 路径穿越、`TRACE`/`PUT`、SuperTokens dashboard 路径均返回 JSON 404；伪造/无签名 JWT（`alg: none`）访问管理接口返回 401。`/auth/jwt/jwks.json` 只暴露公钥，属正常。
- 依赖：根目录与 `backend` 的 `npm audit` 均为 0 漏洞（此前已修复 `proxy-addr` 严重漏洞）。CI 中第三方 Action 已固定到 commit SHA，工作流默认只读权限。
- 主机层面：服务运行在 Railway 容器内，没有 SSH/调试端口由本代码暴露。真正的主机风险在于**账号**：GitHub、Railway、SuperTokens、DNSPod 账号请开启两步验证；任何能推送 `main` 或修改 Railway 环境变量的人都等同于拥有服务器。

## ② 冒充 / 中间人

- **传输**：API 位于 `*.up.railway.app`，`.app` 整个顶级域在浏览器 HSTS 预加载列表中 → 浏览器只会用 HTTPS 连接 API；后端也发送 HSTS。前端 `osagechan.top` 使用 Let's Encrypt 证书，GitHub Pages 已开启 Enforce HTTPS（`http://` → 301 `https://`）。旧地址 `9178osage.github.io/inabakumori-site/` 301 跳到新域名。
- **API 地址不可被篡改**：`js/config.js` 写死 HTTPS 的 Railway 地址，不读取 URL 参数；CSP `connect-src` 只允许自身与该 API，生产构建会去掉 localhost（`check-build` 强制）。
- **CSRF / 冒充用户**：会话令牌通过 `Authorization` 请求头传输（SuperTokens header 模式），不依赖 Cookie 自动携带，第三方网站伪造的表单/请求无法带上用户身份。所有删除与管理接口都在服务端校验会话；会员只能删除自己的留言（SQL 条件含 `user_id`）；管理接口额外检查管理员身份。CORS 只是浏览器读响应的限制，不是认证——伪造 `Origin` 仍然拿不到受保护数据（集成测试覆盖）。
- **游客**：游客只能发帖（每 IP 每小时 3 条、内容过滤、去重），不能删除；不存在可被猜测的“游客删除令牌”。
- **XSS（令牌被盗的主要途径）**：所有服务端数据以 `textContent` 渲染，前端无 `innerHTML`/`eval`；CSP 禁止内联脚本与 `unsafe-eval`。header 模式下令牌存于前端可读存储，因此保持“无 HTML 注入 + 严格 CSP”是关键不变量（`tools/tests/security.test.cjs` 守护）。
- **点击劫持**：已加防嵌入脚本（被第三方 frame 时隐藏页面并尝试跳出）。

## 残余风险与建议（需要账号持有人操作）

1. **HSTS（osagechan.top）**：GitHub Pages 无法为自定义域名添加 HSTS 头，因此无法申请 HSTS 预加载。影响：用户第一次手动输入 `http://osagechan.top` 且网络被控制时可能被降级。若要彻底解决，需要在前面加一层能加响应头的 CDN（如 Cloudflare 代理 + HSTS），这是架构变化，暂不做。
2. **DNS（DNSPod）**：当前只有 2 条 A 记录（185.199.108/109.153）。建议补齐 GitHub Pages 全部 4 条 A（另加 185.199.110.153、185.199.111.153）及 AAAA（2606:50c0:8000::153 … 8003::153）；添加 `CAA 0 issue "letsencrypt.org"`；如需 `www` 再加 CNAME 到 `9178osage.github.io`。在 GitHub 仓库 Settings → Pages 中验证域名（Verified domains）以防域名被他人接管。
3. **管理员授权**：推荐只用 `ADMIN_USER_IDS`。
4. 限流在单进程内存中，重启清零，不防分布式 DDoS（Railway 层面兜底）。

## 回归保护

`tools/tests/security.test.cjs`：禁止后端出现命令执行/动态代码/扩展加载/文件读写/SSRF 原语；所有写操作路由必须要求会话、管理路由必须 `requireAdmin`；header 令牌模式；`ADDITIONAL_WEBSITE_ORIGINS` 校验；前端固定 API、无 HTML 注入、CSP 无 `unsafe-*`；防嵌入保护。`tools/integration.mjs` 额外验证放行的旧来源仍需会话。
