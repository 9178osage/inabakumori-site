# 网站优化与运维说明

本轮（2026-10-01）在既有 HTML / CSS / JavaScript 与 Express / SuperTokens / SQLite 架构上做了一轮综合加固与体验打磨；歌曲资料、账号体系与数据库格式继续兼容。没有修改线上数据库，也没有向生产环境发送测试留言或密码重置邮件。

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
- `/healthz` 增加无秘密的 `uptimeSec`。
- 对 `/api/comments/:id` 与 `/api/admin/comments/:id` 的 DELETE 单独限流（每分钟 30 次）。
- 依赖：传递依赖 axios 升级，后端 `npm audit` 为 0。

### 文档与检查
- 更新本文与 `AI_HANDOFF.md`；新增静态头/CSP/DELETE 限流相关测试。

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
- 请求体限制统一在认证路由之前执行；严格验证游标、昵称、留言长度、不可见内容与控制字符，保留正常 emoji 和多语言输入。
- API 读取限流、统一 no-store、随机请求标识、通用服务错误；不在生产错误日志记录用户输入。
- SQLite 增加个人分页与短期去重索引；后台清理异常不会直接中断服务；设置 HTTP 超时和 10 秒关停上限，正常关停执行 WAL checkpoint。
- 网络请求有 15 秒期限，不自动重试写入，避免超时后重复发帖。
- 本地静态服务器也使用公开文件白名单，不提供目录列表、后端源文件、环境文件或交接文件。

## 本地开发与检查

需要 Node.js 24；前端不再需要 Python。

```sh
npm ci
npm --prefix backend ci
npm run check
npm run test:integration
```

本轮 `npm run check` 的 **74 项测试**、后端语法检查、构建和公开产物校验均通过，HTTP 集成检查通过。桌面 1440px 与手机 390px 浏览器实测完成，检查了三语切换、收藏与排序、筛选恢复、留言验证、会话草稿、深色主题及登录弹窗。HTTP 集成测试使用临时目录、临时端口和独立数据库，结束后清理，不读取真实后端配置。认证相关单元测试使用受控替身，邮件测试仅在内存生成邮件；真实账号登录及真实邮件投递仍需具备有效 SuperTokens 配置后验证。

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

提交代码后，`Verify website` 工作流自动验证并保留 `public-site` 产物。手动发布使用 `Publish public site`：仓库 Settings → Pages 的 Source 设为 GitHub Actions，然后在 main 分支运行该工作流；构建及集成检查通过后才部署。此工作流本轮没有被触发，也没有修改远端设置。参见 [GitHub Pages 官方工作流说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

后端继续采用 Railway 的 `/backend`、Node.js 24、原环境变量和持久化卷；部署后检查 `/healthz`。`TRUST_PROXY` 必须与实际可信代理层数匹配。应用内限流为单进程内存存储，目前适用于现有单实例部署；增加实例前需统一限流存储及数据库方案。

## 数据库备份

```sh
npm --prefix backend run backup
# 或指定一个尚不存在的备份文件：
npm --prefix backend run backup -- /data/.backups/manual-snapshot.db
```

使用 [Node.js SQLite online backup](https://nodejs.org/api/sqlite.html#sqlitebackupsource-db-path-options) 读取包含 WAL 的一致快照，随后 quick_check 校验；备份文件权限 0600，拒绝覆盖源数据库或已有备份。默认保存在数据库目录下的 `.backups/`；应自行保留异地副本。恢复前停止后端、保留现有数据库及 WAL 文件，再使用已验证的快照替换，重启后检查健康接口。该命令已用临时数据库验证，本轮没有复制或读取真实留言数据库。
