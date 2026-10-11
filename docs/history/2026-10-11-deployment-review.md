# 部署与公网安全复核 — 2026-10-11

本报告记录 2026-10-11（America/Los_Angeles）对现网基线 `3386803` 的只读检查。范围为 GitHub Actions、发布流程、DNS、TLS、HTTP 安全头、CORS 和未授权读取边界；应用代码修复及本地回归测试见本轮主审计记录。本报告中的现网结果不代表本轮尚未发布的补丁已经生效。

检查使用公开 DNS 查询、低频 GET / OPTIONS、正常证书校验和 GitHub 只读接口。未注册、登录、发表或删除留言，未传入生产凭据、下载数据库或进行压力测试。三次伪造 IP 头测试只访问 `/healthz`。

## 已核实的部署基线

- 本地初始 HEAD、`git ls-remote origin refs/heads/main` 和 GitHub 分支接口均为 `33868031d750bccda75b34913956d3a144ab34a8`。
- Railway `GET /healthz` 返回 `200 {"ok":true,"version":"3386803"}`。
- `a31320a` 调整限流 IP 来源及备份临时文件清理；`51c23f9` 增加 Trusted Types、404 CSP、Action SHA 固定及 Dependabot；`7fd94cd` 升级 dotenv；`3386803` 升级七项 GitHub Actions，并保留完整 SHA 固定。
- [Verify website](https://github.com/9178osage/inabakumori-site/actions/runs/38127011500) 与 [Publish public site](https://github.com/9178osage/inabakumori-site/actions/runs/38127011494) 在该提交上均为 `completed / success`。
- `https://osagechan.top/` 返回 200，带构建生成的资源 hash；公开 `js/config.js` 指向预期 HTTPS Railway API；首页 CSP 包含 `require-trusted-types-for 'script'; trusted-types 'none'`，`connect-src` 不含 localhost。404 页面也有独立 meta CSP。这些结果与该基线发布的修复一致；静态首页本身没有返回 Git SHA。

另一个同 SHA 的内置 [pages build and deployment](https://github.com/9178osage/inabakumori-site/actions/runs/38127011695) 失败。其部署步骤报告已有 `7fd94cd` 的部署进行中，创建部署返回 400；该次构建成功。不能把此失败误报为依赖升级失效或现网仍是旧版。仓库自定义工作流还同时部署 Pages 和镜像 `gh-pages`，建议在确认 Settings → Pages 的发布源后统一为一条发布链路，避免竞争；本轮未擅自修改发布源或删除兼容路径。

## 公网检查结果

| 检查 | 实际观察 | 能够支持的结论 |
| --- | --- | --- |
| 网站 HTTP | `http://osagechan.top/` → 301 → 同站 HTTPS | 当前服务端启用 HTTPS 跳转；跳转不能保护跳转前的第一条 HTTP 请求 |
| API HTTP | HTTP `/healthz` → 301 → 同 API HTTPS | 当前公网入口会升级普通 HTTP GET |
| 网站证书 | 系统 CA 和域名校验通过，SAN 为 `osagechan.top`，到期 `2027-01-08 08:14:14 UTC` | 当前证书有效，未使用跳过校验选项 |
| API 证书 | 系统 CA 和域名校验通过，SAN 包含 `*.up.railway.app`，到期 `2026-12-26 03:01:42 UTC` | 当前证书覆盖 API 域名 |
| TLS 握手 | 此客户端与两端均协商为 TLS 1.2 | 证明该协议可用；未据此断言服务端不支持 TLS 1.3，也未穷举旧协议/密码套件 |
| API 安全头 | HSTS 一年、CSP `default-src 'none'` / `frame-ancestors 'none'`、`nosniff`、`no-referrer`、Permissions-Policy、`Cache-Control: no-store` | 本次 JSON 响应具备这些防护 |
| Pages 安全头 | 未收到 HSTS、X-Frame-Options 或 CSP HTTP 头；HTML 内有 meta CSP | 仍存在托管层防护缺口，HTML meta 不能替代 HSTS 或 `frame-ancestors` 响应头 |
| 合法 CORS | `Origin: https://osagechan.top` → 200；ACAO 精确为该源 | 当前合法前端源被允许 |
| 不允许的 CORS | `Origin: https://security-review.invalid` → 403 `CORS_ORIGIN_DENIED`，无 ACAO | 该外部浏览器源被拒绝 |
| 预检 | 合法源对 `/api/comments` 的 OPTIONS → 204；允许头为 `content-type,rid,fdi-version,anti-csrf,authorization,st-auth-mode` | 会话 Header 与 JSON 请求的预检可用 |
| 未授权读取 | `/api/comments/mine`、`/api/admin/comments`、`/api/admin/backup` 无凭据均为 401 | 这些路径在本次未授权请求中未泄露受保护数据；备份接口无 ACAO |

Pages 的公开静态响应带 `Access-Control-Allow-Origin: *`，不等于 API 跨域白名单失效；公开资源本来就可被任何人下载。API 地址可见是正常设计，权限必须由服务端会话及管理员检查决定。HTTPS 防止链路窃听和篡改，不把调用者自动变成可信前端。

特别注意：SuperTokens 的 **Header 传输模式不等于浏览器不存 Cookie**。Header 描述 API 如何携带令牌；前端 SDK 的实际令牌存储、Cookie 的 `Secure` 属性及旧值迁移须另行验证。不能用“Header 模式”推导“访问 HTTP 页面不会泄露令牌”。本轮前端审计针对该边界另有补丁。

## Railway 客户端 IP 的证据与边界

在同一短时间窗口依次发送三次 `/healthz` GET：

| 请求 | `RateLimit` 观察值 |
| --- | --- |
| 不附加客户端 IP 头 | `limit=180, remaining=178, reset=32` |
| `X-Real-IP: 198.51.100.31` | `limit=180, remaining=177, reset=32` |
| `X-Real-IP: 203.0.113.62` | `limit=180, remaining=176, reset=31` |

剩余额度连续递减，而非随着伪造头新建限流桶。本次、此公网路径下未观察到该方法绕过限流。测试未耗尽任何限流窗口；这不是跨区域、未来平台版本、私网直连或多实例部署的保证。

[Railway 公网规格](https://docs.railway.com/networking/public-networking/specs-and-limits) 将 `X-Real-IP` 定义为客户端远端地址，并要求公网 HTTP 入口使用 TLS；该文档没有给出完整的头覆写/代理地址稳定性契约。[官方论坛中员工说明](https://station.railway.com/questions/supported-trust-model-for-client-ip-head-aafb68bc)指出 `100.0.0.0/8` 不保证稳定。因此不能把整个地址段自行视为独占、永久可信的代理来源，也不能把本次测试扩大成“所有路径上的头都不可伪造”。

[另一条官方员工确认](https://station.railway.com/questions/need-authoritative-client-ip-proxy-tru-090eac86)明确当前公共 HTTP edge 会覆盖用户传入的 `X-Real-IP`，自定义域和 `*.up.railway.app` 一致；私网请求不经过此处理。该回复将其描述为当前行为，并保留平台变更可能性。这支持保留本轮公共入口的方案，同时明确其适用范围。

运维上应保持该应用经 Railway 公网 HTTP 入口访问；如增加 TCP Proxy、自建反向代理或私网调用者，必须重新核实转发头的信任边界。IP 限流仅是滥用控制，不能代替用户认证、管理员权限或跨实例共享状态；不要为增加“校验”而把所有用户重新归入同一个 CDN IP 桶。

## DNS 与 GitHub 账户配置

本次 DNS 回答：

| 名称 / 类型 | 返回值 |
| --- | --- |
| `osagechan.top A` | `185.199.108.153`、`185.199.109.153` |
| `osagechan.top AAAA` | `2606:50c0:8000::153`、`2606:50c0:8001::153` |
| `osagechan.top CAA` | `0 issue "letsencrypt.org"` |
| `_github-pages-challenge-9178osage.osagechan.top TXT` | 与用户给出的验证值一致 |
| `www.osagechan.top A / CNAME` | NXDOMAIN |

当前 A / AAAA 值属于 GitHub Pages 官方地址。仅配置部分地址与 `www` 缺失是可用性/完整性问题，没有据此发现域名被劫持。GitHub 的完整配置列出四个 IPv4 和四个 IPv6 地址；如 DNS 服务限制记录数，可与域名管理员确认支持的 ALIAS/ANAME 方式。`www` 需要时可设置 CNAME 到 `9178osage.github.io`，不能附仓库路径。参见 [GitHub 自定义域名配置](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)。

TXT 用于让 GitHub 确认账户对域名的控制权并降低 Pages 域名接管风险；**DNS 中存在 TXT 不足以证明 GitHub 账户页面已完成 Verify**。应保留该记录。**更新（2026-10-11）**：账户 Settings → Pages 已确认 `osagechan.top` 为 Verified。CAA 约束允许签发证书的 CA；它不会路由流量、验证登录用户或替代 TLS。当前 CAA 允许 GitHub 使用的 Let's Encrypt。参见 [GitHub 域名验证](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages)与 [Let's Encrypt CAA 文档](https://letsencrypt.org/docs/caa/)。

GitHub 分支 API 返回 `protected: false`、`protection.enabled: false`、`required_status_checks.enforcement_level: off`；仓库 rulesets（包含父级）列表为 `[]`。这说明检查时 `main` 没有这些发布前保护。建议（与当前“直接推送 main”的工作方式兼容）：为 `main` 建立 ruleset，至少启用 **Restrict deletions** 与 **Block force pushes**，无需绕过名单。暂不要求 PR/必需检查，否则维护者与每周浏览量工作流的直推会被阻断；若以后改为 PR 流程，再把 `Verify website` 的 `check` job 设为必需检查，并把浏览量工作流改为开 PR。本轮未修改 GitHub 管理设置。

工作流层面已确认：Action 固定到 40 位 SHA；构建 job 只有读取权限，安装依赖与发布写权限分离；部署只在 main；没有 `pull_request_target`；`dist` 由显式公开资源白名单生成。YouTube 定时更新 job 仍需要 `contents: write` 并直接推送分支，API 密钥仅传给对应步骤，额外的 workflow dispatch 权限在独立 job；未发现无需仓库写权限即可借此执行任意代码的路径。

**更新（2026-10-11）**：GitHub 域名已 Verified；Pages 发布源已改为 GitHub Actions（此前同时为“从 main 分支部署”，内置 pages-build-deployment 会上传约 118 MB 原始仓库并与 `deploy-pages` 竞争）。仍未核实的管理面包括账户 2FA、Railway 内部/TCP 暴露配置、WAF/账单限制、SuperTokens 平台配置与备份恢复演练。这些需要相应控制台权限；不能由公网 200/401 或本地测试推断已配置。未对生产密钥进行读取。

本次对话显示域名由另一位管理员提供。DNS 管理员能改变网站指向并控制域名验证，因此也是必须信任的网站管理员。CAA、GitHub challenge TXT、HTTPS 或 `__Host-` Cookie 都无法防止有 DNS 管理权限的人主动改站点。这与“别人知道公开 API 地址”是不同的权限边界；应明确域名续费、DNS 管理和收回权限的安排。
