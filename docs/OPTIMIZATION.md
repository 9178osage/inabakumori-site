# 网站优化与运维说明

本轮（2026-10-01）在既有 HTML / CSS / JavaScript 与 Express / SuperTokens / SQLite 架构上做了一轮综合加固与体验打磨；歌曲资料、账号体系与数据库格式继续兼容。没有修改线上数据库，也没有向生产环境发送测试留言或密码重置邮件。

## 2026-10-28 独立静态资源试点

撤回整站 Cloudflare DNS 切换，删除未激活的临时站点配置；朋友提供的域名继续使用 DNSPod 和 GitHub Pages。独立 Pages 项目只为手机画廊前 6 张缩略图提供内容指纹 URL 和一年浏览器缓存，加载失败自动回到本站原文件。首屏图、字体、桌面画廊和大图不切换。CSP 仅在首页 `img-src` 增加实际资源域名，登录与 API 沿用原入口。

公开白名单打包、字节清单、失败回退、配置一致性及响应式切换均有回归覆盖。本机小样本尚不能证明网络提速，保留小范围试点；具体部署、回退开关和验证范围见 [资源试点说明](CLOUDFLARE.md)。

## 2026-10-28 登录按需加载

首页改为加载 3,107 字节的小型认证入口。没有会话凭据的访客读取公开留言或发布游客留言时，不下载 179,291 字节的完整认证包；打开登录、已有会话、密码重置链接或跨标签页登录会触发加载。会员的首次请求等待 SDK 的 header 拦截器准备好，加载失败可重试。生产构建为加载器和动态导入目标分别计算内容指纹，并校验引用的认证包；动态导入继续受原 `script-src 'self'` 限制，没有增加 TrustedScriptURL 写入或放宽 CSP。

SDK 默认将完全空的 Cookie 状态视为可能存在会话，从而尝试刷新并得到 401。Cookie 读取适配器仅在没有 front/access/refresh 凭据和原有更新标记时，返回一个虚拟的已退出标记；不写入真实 Cookie，也不代替服务端鉴权。原 Secure／host-only 命名空间维持不变，真实过期会话和仅剩刷新令牌的会话继续由 SDK 恢复。重置参数在加载完整认证包前从地址栏清除，并只在页面内存中传递。

实际安装的 SDK 合成网络测试覆盖匿名读取与游客发布零刷新、真实登录和会员请求头、过期刷新、刷新令牌恢复及退出；加载器测试覆盖并发加载、失败重试、跨标签页和重置入口。测试不等同真实浏览器点击或真实账号登录。Cloudflare 的当前接入范围单独记在 [资源试点说明](CLOUDFLARE.md)。

## 2026-10-28 公开留言列表缓存

只有 `GET /api/comments` 的公开数据进入实例内存缓存，最多保留最近 100 条、30 秒；同时到来的冷读取共用一次查询。有效期从查询开始计算，并在最早一条游客留言到期时提前结束；查询期间已过期的记录也不返回。失败不缓存、不延用已过期快照。

发布、会员删除、管理员删除和过期清理成功后，清除当前实例缓存；旧查询即使晚完成，也不能恢复写入前的快照。前端在发布成功后的 30 秒内保留新留言，与旧列表合并，删除仍使用本页标记防止复现。个人、管理员列表和备份不进入缓存，CORS、登录鉴权与共享限流维持原有顺序。

Vercel 可复用实例并在实例内处理并发，但不同实例不共享这份内存。10-28 起数据库 `comment_list_version` 单行计数由 `comments` 行级触发器在同一事务内递增（插入、修改、删除、过期清理均覆盖，回滚不递增）；实例命中内存前先读这一行，版本变化即重新查询，其他实例的发布与删除在下一次读取时可见。版本读取失败时继续使用未到期快照，最长 30 秒。迁移只用 `IF NOT EXISTS`/`ON CONFLICT DO NOTHING` 与存在性检查，重复冷启动不重置计数、不删除任何对象。

不带任何凭据（无 `Authorization`、`Cookie` 及 SuperTokens 请求头）的列表读取返回 `Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=30`、`Vary: Origin, Authorization` 与 `Vercel-Cache-Tag: public-comments`，并去掉逐客户端的 RateLimit 头；带凭据、非 200 的响应仍为 `no-store`。不按 `Cookie` 区分，因为 [Vercel 不缓存 `Vary: Cookie` 的响应](https://vercel.com/docs/caching/cdn-cache)，带 Cookie 的请求直接不进入共享缓存。发布、删除和过期清理成功后用 `dangerouslyDeleteByTag` 删除该标签的 CDN 副本（[所有方案可用](https://vercel.com/docs/caching/cdn-cache/purge)）；清除调用失败时只记录脱敏元数据，CDN 旧列表最多保留 30 秒新鲜期加 30 秒后台重验证，即删除的留言最迟约 60 秒消失。[Vercel 实例与并发说明](https://vercel.com/docs/functions) 30 秒是服务端缓存寿命，已打开页面没有再次读取时不会自动刷新。缓存只减少公开列表的 SELECT，前面的 PostgreSQL 限流计数仍执行；没有据此估算线上提速或费用降幅。确定性时钟测试覆盖命中、到期、空列表、并发、失败、删除权限及写入与读取竞争；隔离 HTTP 集成检查覆盖暖缓存后的发布可见性、逐请求 CORS 和请求 ID。

## 2026-10-27 手机首页

手机首页仅请求 Station Mono 数字字体（8,772 字节），正文、标题、歌曲名及中文首屏导航使用系统字体，减少三套 CJK 字体共 319,748 字节。原有脚本已使用 `defer`，继续保留加载顺序；初始语言文字与当前内容相同时不重复改写 DOM。登录、鉴权和安全策略未变。

手机画廊初始只构建 6 个按钮，展开后再追加其余 101 个，没有桌面跑马灯副本或轮询；220px 缩略图共 659,586 字节，比原 300px 缩略图小 35.9%。桌面缩略图和大图原样保留。生成器新增 `--mobile-only` 以补充手机资源，常规生成和 `--config-only` 也校验这些资源。

同机 Lighthouse 13.5.0 两轮手机对照为旧版 66／74，新版 82／84；桌面单次 96 → 98，自动无障碍与 SEO 检查均为 100。测试配置、指标和不能验证的交互边界见[详细记录](history/2026-10-27-mobile-home.md)。

## 2026-10-24 运行时开销

PostgreSQL 初始化把固定的 `BEGIN`、事务级锁、建表/索引检查和 `COMMIT` 合成一条简单查询协议消息，数据库往返由 4 次降为 1 次。留言写事务把 `BEGIN` 与同一把事务级锁合批，控制命令由 3 次降为 2 次；回调仍等待锁取得，留言内容等用户输入继续绑定参数，出错后单独回滚。批次共用既有查询超时，未提高超时上限。实际 `pg.Client` 与内存 PostgreSQL 协议测试覆盖消息数量、持锁、参数绑定、初始化失败和写入失败后的回滚与复用；该单连接测试不代表线上多连接压测。

动态页每种语言按需复用一个固定 JST 日期格式化器，恢复页面时日期文字相同则不重复写入 DOM。当前作品页有 31 个本地化时间，首次构造次数由 31 次降为 1 次；中英日、JST 跨午夜及无效日期的显示与原来一致。在本机 Node 24.22.1 的完整脚本 VM 合成测量中，31 个时间的首次处理约 0.97 → 0.13 ms，同语恢复的 9 次中位约 0.91 → 0.04 ms。这些数据不含浏览器布局、绘制和网络，不能当作真机整页提速比例。

## 2026-10-22 审查后的运维修复

- YouTube 播放量刷新改为只读作业获取数据并运行四项门禁，独立写入作业只提交已检查的文件；如果 `main` 已前移则失败，重新检查后再推送。提交后等待对应 Verify / Publish 成功，并核对线上歌曲文件指纹。
- 上线记录核对遇到分页总数变化、重复或乱序时，丢弃整次扫描和分页缓存，等待后从第一页重试一次；持续变化、缺行、缺锚点、网络或限流错误仍然失败，不混用两轮证据。
- 数据库路径配置、目录或 SQLite 初始化失败时，后端给出简洁的配置或初始化错误并退出；文件系统异常不输出路径或堆栈。备份接口继续拒绝 HEAD，补上 `Allow: GET`，避免为无正文请求生成快照。
- CI 使用 `ubuntu-24.04`，避免 `ubuntu-latest` 自动切换系统版本；Node 仍固定为 24.22.1。Pages 双发布渠道保留，待实际仓库 Pages 设置核实后再清理。

10 月 18–20 日的创作者刷新日志显示 YouTube 来源校验失败（`Unexpected video metadata or author`），其余来源正常，保留历史数据并发布失败状态；后续修复后的运行已成功。10 月 22 日的另一轮失败是 GitHub 分页总数不一致，两者原因不同。当时后端须单独核对 Railway 和 `/healthz`；迁移后的当前入口改为 Vercel，部署核对见 [站长手册](MAINTAINER.md)。前端发布成功不代表后端安全升级已生效。

## 2026-10-20 目录整理与帖子构建优化

`build-site.mjs` 为一次构建创建独立的 X 帖子渲染快照，6,109 条记录只校验、排序和分组一次，每条正文的转义 HTML 在首页与 408 个档案页之间复用。快照通过深复制与调用方隔离，缓存仅属于当次构建；回归覆盖分页、作者切换、调用方修改及预览之外的不安全记录拦截。原有渲染函数保留兼容入口，分页地址由同一个 URL 函数生成。

在同一台机器上各运行一次完整构建：优化前约 5.45 秒，优化后约 0.83 秒，耗时减少约 85%。这是单次测量，会随机器负载波动。全部 743 个公开文件的 SHA-256 与优化前逐一相同，包含完整帖子正文、分页、三语内容及安全策略。

历史本地报告、日志、部署核验、公开采集原件与手工脚本按用途归档，移动清单和前后哈希保存在被忽略的 `artifacts/reports/organization-20261020.json`；一个历史脚本的两处相对路径随目录调整。清理了 `dist 2/`、`dist 3/` 的空目录树，并增加根目录编号构建副本的忽略规则。当前源码路径、生成器原图输入及联网门禁缓存路径保持稳定。新增文档和工具导航，便于区分维护入口、发布数据与本地检查材料。

## 2026-10-15 复查后的四项修复

- EmailPassword 和 Session 的 SDK 请求统一增加 15 秒可中止超时，保留调用者已有的取消信号，兼容没有 `AbortSignal.timeout/any` 的旧 Safari；真实 SDK 的合成网络测试覆盖登录、注册、密码重置、退出及过期会话刷新后的恢复。
- 图片优化对输入、输出和父目录统一使用 `assertRepoPath`，编码前再次检查，拒绝沿符号链接读取或覆盖仓库外文件；回归使用临时仓库和编码器替身，不批量重写实际图片。
- 构建跳过隐藏素材目录，产物检查拒绝隐藏路径，仅允许 `dist/` 根目录的普通 `.nojekyll` 文件；不再依赖上传步骤过滤隐藏内容。
- 个人和管理员留言列表按 ID 复用行和按钮，删除失败保留焦点，成功转到相邻留言或空列表状态；用户在等待期间移开焦点不会被抢回，身份切换和迟到响应保护继续生效。

验证：233 项自动测试、后端语法检查、生产构建与产物检查、隔离 HTTP 集成测试通过。浏览器使用本地模拟数据验证认证请求实际超时中止，以及留言失败、成功和主动移开焦点的场景；没有向生产环境发送测试留言或密码重置邮件。发布状态以对应提交的工作流结果及线上资源核对为准。

## 2026-10-12 本轮变更摘要

范围：`b25933c` 至 `52ea6c0`（2026-10-11 晚至 2026-10-12）。

### 关于 / 导航
- 彩蛋去掉「今日预报」一行（`b25933c`）。
- “关于”有独立锚点 `#site-about` 和整宽区块（`56fd97e`）；之后在 `6604a7d` 中“关于”回到简介下方，导航与首屏不再有“关于”入口。
- 章节导航加入“关于”；点登录弹窗背景可关闭；收藏为空时给出提示；手机端顶部按钮背后加实色底带（`03293ee`）。
- 章节导航高亮改为按滚动位置计算（rAF 节流），不再用 IntersectionObserver 区间判断；锚点跳转后高亮正确，回到首屏时不高亮；首屏、留言墙、画廊的观察器只读最后一条记录（`c3c0fce`）。

### 前端 bug
- 审查 14 项 + B1–B10（`b420216`）：320px 宽度下控件和章节导航不再溢出；浅色模式次要文字 `#474747`（对比度 5.1:1）；画廊为一个 Tab 停靠点、方向键切换，并加“跳过歌曲”链接；`aria-label` 随语言切换；灯箱高度用 `100dvh`（带 `100vh` 回退）；`js/songs.js` 加载失败时页面其余功能仍可用；中文播放量只用 万/亿；Enter / Ctrl+Enter 发送留言；留言墙和画廊只在真实尺寸变化时（防抖）重排；`AbortSignal.timeout` 回退。
- 限流 429 对可信来源带 CORS 头，页面能读到 `Retry-After`；会话过期时账号按钮恢复未登录状态；最后一条留言过期后显示空墙状态（`4fab0d1`）。
- 交互问题第二轮（`e63bc16`）：手机/浏览器“返回”可关闭灯箱，并保持打开时的滚动位置；触屏打开灯箱后不会被后续点击立即关闭，焦点回到点击的缩略图；读取留言 429 时显示“N 秒后重试”（三语）；登录按钮检查会话期间显示忙碌状态并忽略重复点击（仅界面）；切换语言保持阅读位置；留言过滤中“加”只在 我/微信/qq/v 等前才算联系方式。
- `4358d04`：空提交，重新触发 Railway 部署（上一次部署失败）。

### 手机端（`df2bbcf`）
- 悬停样式只用于有指针的设备，触屏改用 `:active`；横屏安全区宽度修正。
- 社交图标缩到 128px（521 KB → 69 KB）；章节导航条随当前链接滚动；登录弹窗保持页面滚动位置；画廊初始化移出启动任务；链接加 `touch-action`。
- 首次访问传输量约 1291 KB → 852 KB。

### 性能（`f01b4d8`）
- 歌曲列表在文档外拼好后一次插入；留言墙先全部插入再统一测量，避免每条留言强制重排。
- 画廊跑马灯改用 Web Animations（合成线程），不再每帧用 JS 改样式；悬停、聚焦、拖动、离屏、灯箱打开时暂停。
- 画廊缩略图改为浏览器原生懒加载，不再随首屏下载。
- 顶部控件底带改为给 `.site-controls` 加类，不再用 `body:has()`（避免整页样式重算）。
- 社交图标缩到 72px（每个约 1–2.5 KB）；`icon-192.png` 36 KB → 18 KB；手机首屏图 54 KB → 28 KB；手机 hero 003 474 KB → 387 KB；三个字体去掉 hinting（字符集不变，约省 22 KB）。
- Lighthouse 移动端 49 → 83（TBT 830 ms → 50 ms，LCP 5.3 s → 4.0 s，页面 721 KB → 509 KB）；桌面端保持 100。**均为单次测量**，有波动。

### 后端 / 校验 / 日志
- 备份下载只在响应完整发出后才记录 “Backup served”，客户端中途断开记为 “Backup aborted”，临时副本照常删除（`e5a32a9`）。
- 重复留言检测只看未过期的留言（`e5a32a9`）。
- 前端字数按 NFC 规范化后计数，与服务器一致；提交时不再静默截断，超长会提示；输入超长时截断并提示（`e5a32a9`）。
- 服务器与前端都拒绝孤立代理项（lone surrogate），正常 emoji 与生僻字不受影响（`e5a32a9`）。
- 备份中断测试移到备份测试文件内，避免并行测试的临时目录计数互相干扰（`26185fa`）。
- 错误处理保留 400–499 状态码（如 body-parser 对损坏的 gzip/deflate/br 请求体返回 400，而不是 500），只返回通用提示，不泄露错误详情（`54e3dd0`）。
- 同一提交：“内容包含无效字符”补日文；输入法组字期间不截断，组字结束后再限长；“返回顶部”的 `aria-label` 随语言切换；noscript 提示加日文；深色 `theme-color` 改由 `<meta media="(prefers-color-scheme: dark)">` 决定，不依赖 JS，手动切换主题仍覆盖（`54e3dd0`）。
- Safari 组字结束后可能不触发 `input`：`compositionend` 时也刷新字数和草稿；草稿只在内容变化时写入，不会重复保存（`52ea6c0`）。

### 未做
- **Service Worker**：CSP 的 `worker-src 'none'` 会阻止注册；即使改成 `'self'`，`trusted-types 'none'` 也会让 `navigator.serviceWorker.register()` 被 Trusted Types 拦截。选择保持 CSP 不变，因此不加。
- **L4（600px 缩略图）**：会超过 12 MiB 的发布体积上限。
- **内联 `fonts.css`**：需要 CSP 放开内联样式（`style-src`），未做。

---

## 2026-10-02 本轮变更摘要

### CSP
- 去掉 HTML `onclick` / 内联处理器，改在 `script.js` 的 `DOMContentLoaded` 里用 `addEventListener` 绑定（语言、主题、登录、随机歌曲、留言重试/发送等）。
- 雨景 CSS 变量从 `<span style="--rain-…">` 迁到 `style.css` 的 `.hero-rain span:nth-child(n)`，首页与本地预览服务器的 CSP 均可去掉 `script-src` / `style-src` 的 `'unsafe-inline'`。
- 后端 API 的 Helmet CSP 仍为 `default-src 'none'`（只服务 JSON），无需改动。三语切换与标题连点 5 次彩蛋逻辑不变。

### YouTube 播放量定时刷新
- 已有 `tools/refresh-youtube-views.mjs`（失败不编造数字）。新增 `.github/workflows/refresh-youtube-views.yml`：每周一 cron + `workflow_dispatch`。
- **必须**在仓库 Settings → Secrets and variables → Actions 设置 `YOUTUBE_API_KEY`（YouTube Data API v3）。切勿写入仓库或 `.env` 提交。
- 工作流用 `GITHUB_TOKEN`（`contents: write`）在有变更时直接提交 `js/songs.js`。`GITHUB_TOKEN` 触发的 push 不会再次跑工作流。若组织禁止 token 推 main，工作流注释里写了改开 PR 的备选步骤。
- 本地：`YOUTUBE_API_KEY=... node tools/refresh-youtube-views.mjs`

### 原始 hero 图与发布体积
- **决定**：继续把 `images/hero/`、`images/hero-mobile/` 留在仓库，供 `npm run optimize:images`（cwebp）生成 `images/optimized/**`。
- `npm run build` / GitHub Pages **只复制** `images/optimized/**`（及图标、梗图、根目录社交图标），**不会**把原始 PNG 打进 `dist/`，因此 Pages 产物不会因原图膨胀。静态预览白名单同样只服务公开路径。
- 若将来要进一步缩小克隆体积，可再把原图迁到未部署的 `archive/` 并 gitignore，但当前优先保留优化源文件。

---

## 2026-10-01 本轮变更摘要

### 前端
- 无障碍：语言按钮与主题按钮补齐/同步 `aria-label` 与 `aria-pressed`；章节导航、留言墙、跳过链接随语言更新；留言墙加载时设置 `aria-busy`。
- 焦点：搜索框与留言输入改为 `:focus-visible`，章节导航与发送按钮补齐可见焦点环。
- 性能：增加 API / YouTube 缩略图 `dns-prefetch` 与 API `preconnect`；首屏主题色在 `preferences.js` 尽早写入，减少闪烁。
- SEO：补充 `og:locale` 及备用语言；sitemap 增加 `lastmod` / `changefreq`；404 使用相对回站链接并带 theme-color。
- 安全：首页增加 CSP meta；本地静态预览服务器增加 CSP、Permissions-Policy、X-Frame-Options、COOP，未知路径返回 `404.html`。（2026-10-02 已去掉 inline 处理器与雨景 style 属性上的 `unsafe-inline`。）
- 留言墙：发送按钮固定 id，加载状态更准确反馈。

### 后端
- Helmet：`Cross-Origin-Resource-Policy: cross-origin`（跨域 Pages → Railway JSON）；增加 `Permissions-Policy`。
- `/healthz` 只返回 `{ ok, version }`；`version` 为部署提交前 7 位，用于确认重新部署（2026-10-11 起移除 `uptimeSec`/环境信息）。
- 对 `/api/comments/:id` 与 `/api/admin/comments/:id` 的 DELETE 单独限流（每分钟 30 次）。
- 依赖：传递依赖 axios 升级，后端 `npm audit` 为 0。

### 文档与检查
- 更新本文与 `AI_HANDOFF.md`；新增静态头/CSP/DELETE 限流相关测试。安全现状统一见 [SECURITY.md](SECURITY.md)。

---

## 页面与使用体验

- 保留原有插画、雨景和三语内容，重新组织首页标识、引导按钮、章节导航、留白和移动端布局。
- 歌曲支持收录顺序、播放量、名称排序；星标收藏保存在当前浏览器；“只看收藏”与原有搜索共同生效。
- 搜索和排序写入 URL，刷新后恢复；复制筛选链接不包含个人收藏列表；按 `/` 聚焦搜索。
- 留言提供静态阅读模式，遵从系统“减少动态效果”；离开视口或后台时暂停动画。
- 输入框有明确标签、字数计数和页面内反馈；草稿仅保存在当前标签页的 sessionStorage，成功发送时清理已发送内容，保留发送过程中继续输入的内容。
- 首次主题遵从系统，保存过的主题优先；本地存储不可用时使用内存回退；登录弹窗限制背景操作并恢复焦点。

## 体积与加载

| 项目 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 67 张背景资源 | 19,853,756 bytes | 3,579,736 bytes（减少约 82%） |
| 认证脚本 | 250,906 bytes | 约 176 KB（构建时完整压缩） |
| 发布包 | 原先直接使用仓库根目录 | 约 5.1 MiB，仅公开文件 |

原始背景继续保留在 `images/hero/` 和 `images/hero-mobile/`（供 `optimize:images` 使用；**不**打入 `dist`/Pages），线上只部署 `images/optimized/`。图片通过本机 cwebp 以质量 82 转换，不依赖第三方在线压缩服务。安装 cwebp 后可运行 `npm run optimize:images` 重建；日常 `npm run build` 使用已生成资源，无需安装图片工具。增加首图的响应式 picture 与预加载；手机端不会在首屏下载完整背景库；切换后只预取下一张，节流模式不预取；解码图片缓存最多保留三项。

脚本延迟解析，生产构建压缩 CSS / JS，资源 URL 使用内容摘要避免更新后加载旧版本。留言 API 在接近留言区时才读取。构建后的 51 首歌曲直接写入 HTML，即使 JavaScript 未运行仍可打开歌曲链接。以上为资源与功能验证结果，不是 Lighthouse 分数或真实用户性能指标。

## SEO 与外部入口

补全 canonical、Open Graph 分享图、Twitter Card、WebSite JSON-LD、sitemap、robots 和独立 404 页面。51 个 YouTube 链接均已只读检查，返回 HTTP 200；这不等于验证了各地区的实际播放权限。原有播放量及统计日期未修改。

## 后端与安全

- Nodemailer 升级到 **10.0.13**，ip-address 升级到 **10.7.2**，已同步锁文件；前后端 npm audit 无已知漏洞。
- 2026-10-21：后端补丁/小版本升级 dotenv 18.0.8、Express 5.3.0（随附 content-disposition 2.0.1、content-type 2.1.0）、supertokens-node 24.0.4；覆盖版本同步为 Nodemailer **10.1.7**（supertokens-node 24.0.4 自身要求 ^10.1.7）与 ip-address **10.7.4**；npm audit 0。
- 请求体限制统一在认证路由之前执行；严格验证游标、昵称、留言长度、不可见内容与控制字符，保留正常 emoji 和多语言输入。
- API 读取限流、统一 no-store、随机请求标识、通用服务错误；不在生产错误日志记录用户输入。
- SQLite 增加个人分页与短期去重索引；后台清理异常不会直接中断服务；设置 HTTP 超时和 10 秒关停上限，正常关停执行 WAL checkpoint。
- 网络请求有 15 秒期限，不自动重试写入，避免超时后重复发帖。
- 本地静态服务器也使用公开文件白名单，不提供目录列表、后端源文件、环境文件或交接文件。

## 本地开发与检查

本地检查使用 Node.js 24.22.1，与 CI 固定版本一致；前端不再需要 Python。生产运行版本另按 [安全与运维现状](SECURITY.md) 核对。

```sh
npm ci
npm --prefix backend ci
npm run check
npm run test:integration
```

2026-10-01 时 `npm run check` 的 **74 项测试**（2026-10-11 为 113 项）、后端语法检查、构建和公开产物校验均通过，HTTP 集成检查通过。桌面 1440px 与手机 390px 浏览器实测完成，检查了三语切换、收藏与排序、筛选恢复、留言验证、会话草稿、深色主题及登录弹窗。HTTP 集成测试使用临时目录、临时端口和独立数据库，结束后清理，不读取真实后端配置。认证相关单元测试使用受控替身，邮件测试仅在内存生成邮件；真实账号登录及真实邮件投递仍需具备有效 SuperTokens 配置后验证。

```sh
npm run frontend   # 源码预览，http://127.0.0.1:5500
npm run build      # 生成 dist/，并重新生成 js/auth.js
npm run build:local # 同 build，但 CSP 保留 127.0.0.1:3001 / localhost:3001（仅本地，勿部署）
npm run preview    # 先 build:local 再预览产物，同为 5500 端口；与 frontend 二选一
npm run backend    # 需要 backend/.env 中的真实后端配置
```

`FRONTEND_PORT` 可改变预览端口；如果测试账号或留言，后端 WEBSITE_URL 也需匹配预览 Origin。没有配置本地后端时，前端仍可浏览歌曲，留言区会显示连接失败并提供重试。

## 发布

应发布 **dist/**，不要公开仓库根目录。构建产物不包含后端、测试、交接说明、环境文件或数据库。

提交代码后，`Verify website` 工作流自动验证并保留 `public-site` 产物。推送 `main` 后由 `Publish public site` 构建并部署（仓库 Settings → Pages 的 Source 已于 2026-10-11 设为 GitHub Actions），构建及集成检查通过后才部署；也可手动运行该工作流。参见 [GitHub Pages 官方工作流说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

当前生产后端为 Vercel 项目 `inabakumori-backend`，根目录 `backend`，留言与共享限流计数均使用独立 Neon PostgreSQL；部署后核对 Vercel 状态和 `/healthz`。原 Railway 服务连接同一 PostgreSQL 并核验后已停止。重新启用回退服务时仍须使用当前 PostgreSQL，不能恢复旧 SQLite 写入；具体步骤见 [迁移与回退说明](VERCEL.md)。代理与 IP 头信任边界见 [安全与运维现状](SECURITY.md)。

## 数据库备份

生产 PostgreSQL 通过受保护快照接口和数据库提供商支持的方式备份，说明见 [安全与运维现状](SECURITY.md#备份与例行检查)。以下命令与文件替换步骤仅用于本地 SQLite 和隔离恢复演练，不用于生产 PostgreSQL；运行前确认 `COMMENTS_DB_PATH` 指向本地实验数据库。

```sh
npm --prefix backend run backup
# 或指定一个尚不存在的备份文件：
npm --prefix backend run backup -- /private/backup/manual-snapshot.db
```

该本地工具使用 [Node.js SQLite online backup](https://nodejs.org/api/sqlite.html#sqlitebackupsource-db-path-options) 读取包含 WAL 的一致快照，随后 quick_check 校验；备份文件权限 0600，拒绝覆盖源数据库或已有备份。默认保存在本地数据库目录下的 `.backups/`，应自行保留异地副本。在本地恢复演练中，先停止实验后端、保留现有实验数据库及 WAL 文件，再用已验证的快照替换，重启后检查健康接口。该命令在 2026-10-01 以临时数据库验证，当时没有复制或读取真实留言数据库。生产恢复须按 [迁移与回退说明](VERCEL.md#回退与后续备份) 先保留当前 PostgreSQL，并在隔离环境核对快照与迁移后的新增、删除，不能直接以旧文件替换生产数据源。
