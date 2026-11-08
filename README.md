> **Project status / 项目状态 / プロジェクトの状態**
>
> GitHub Actions builds and publishes only `dist/`. Before committing, pass all four gates: `npm test`, `npm run check`, `npm run test:integration`, and `npm run check:changelog`. The last command verifies deployment records online and is separate from `check`.
>
> 生产环境只发布 `dist/`。提交前须通过测试、综合检查、HTTP 集成测试及上线记录联网核对四项门禁；`npm run check` 不包含最后一项。发布与副本同步流程见[站长手册](docs/MAINTAINER.md)。
>
> 公開するのは `dist/` のみです。コミット前に上記 4 コマンドをすべて実行してください。公開記録のオンライン照合は `npm run check` に含まれません。

维护入口 / Maintenance / メンテナンス：[文档导航](docs/README.md) · [工具与命令](tools/README.md) · [站长手册](docs/MAINTAINER.md)。

<a id="readme-en"></a>

# 🌧️ Weather Observation Station · 稲葉曇

🇺🇸 **English** | 🇨🇳 [中文](#readme-zh) | 🇯🇵 [日本語](#readme-ja)

> An unofficial fan site made out of a love for **稲葉曇 / Inabakumori**.  
> Browse songs and their sources, collected X posts, NKNK illustrations, and creator links, with a message wall and account features.

🌐 **Live site:** [osagechan.top](https://osagechan.top/)

![Build](https://github.com/9178osage/inabakumori-site/actions/workflows/check.yml/badge.svg)
![Pages](https://github.com/9178osage/inabakumori-site/actions/workflows/pages.yml/badge.svg)

### Contents

- [Features](#-features)
- [Tech stack](#️-tech-stack)
- [Run locally](#-run-locally)
- [Checks and build](#-checks--build)
- [Deployment](#️-deployment)
- [中文](#readme-zh)
- [日本語](#readme-ja)

---

## 🌧️ About This Project

**Weather Observation Station** is a personal fan site dedicated to Inabakumori.

The frontend is built mainly with vanilla HTML, CSS, and JavaScript, without a large framework. Alongside song information and related links, the site includes multilingual support, theme switching, responsive layouts, an account system, and a message wall.

The project is still evolving. It is not meant to be authoritative or exhaustive; it is simply a carefully maintained fan project.

> This is an unofficial, non-commercial fan project and is not affiliated with Inabakumori, Nukunuku Nigirimeshi, or any official label/platform.

---

## ✨ Features

### 🎵 Song Library

- Inabakumori songs with links to their MVs
- Album, vocalist, and tag metadata
- Recorded YouTube view counts with the date last checked
- Fuzzy search across song titles and tags
- Multi-keyword search
- Require terms with `+keyword`
- Filter by tags
- Pick a random song
- Search-result count
- Sort by original order, recorded views, or title
- Save star favorites in this browser and filter to favorites
- Browse the song archive by album or year; individual pages provide release details, credits, and sources, with unverified information marked
- On mobile, start with selected songs and expand to search the full library

### 🗂️ Collected Posts & Creator Updates

- The homepage shows each creator's latest collected X post, with its collection time
- Read collected posts in paginated archives, filter by creator, and resume your reading position
- Keep original text alongside Chinese and English summaries where available; view images and videos at the original post
- Browse YouTube, pixiv, and CAMPFIRE work updates on the first archive page and filter by creator
- Collection is incomplete and is not a live X feed; work-source checks run daily, while YouTube view counts refresh weekly

### 🖼️ Gallery & Little Calendar

- Browse NKNK illustrations in a scrolling gallery, open larger images, and pinch to zoom on mobile
- The “Secret little calendar” counts days since the latest collected Inabakumori YouTube song, using Japan time

### 🌐 Languages

Currently supported:

- 中文
- English
- 日本語

Your language preference is saved locally in the browser.

### 🌙 Interface & Visuals

- Light / dark theme switching
- Responsive layouts for desktop and mobile
- Separate background sets for desktop and mobile
- Rain effects
- Title effects
- A hidden forecast easter egg triggered by five title clicks
- Theme and language preferences saved locally
- Web App Manifest

### 🔗 Inabakumori & NKNK Links

The site collects Inabakumori-related links and resources across:

- YouTube
- X / Twitter
- Niconico
- Bilibili
- Instagram
- TikTok
- Pixiv
- Wikipedia
- Inabakumori Wiki
- VOCALOID Wiki

It also includes links related to **ぬくぬくにぎりめし (NKNK)**.

### 👤 Account System

Authentication is powered by **SuperTokens**:

- Email/password sign-up
- Sign in / sign out
- Session management
- Password reset

### 💬 Message Wall

- Guest and signed-in posting
- Signed-in users can review and delete their own posts
- Paginated loading
- Admin moderation tools
- Message-length limits
- Rate limiting
- Basic spam, link, and contact-information filtering
- Automatic expiration for guest posts

---

## 🛠️ Tech Stack

### 🖥️ Frontend

- HTML5
- CSS3
- Vanilla JavaScript
- SuperTokens Web JS
- esbuild

### ⚙️ Backend

- Node.js 24
- Express 5
- SuperTokens Node
- PostgreSQL (`pg`, production)
- Node.js built-in SQLite (`node:sqlite`, local development and offline backups)
- Helmet
- CORS
- express-rate-limit
- dotenv

---

## 📁 Project Structure

```text
inabakumori-site/
├── index.html              # Frontend entry (keep at repo root)
├── updates.html / updates.css # Post archive template and styles
├── calendar.html / calendar.css
├── archive.css             # Song archive styles; HTML is generated in dist/
├── style.css / script.js
├── site.webmanifest
├── robots.txt / sitemap.xml / 404.html
├── package.json / README.md / SECURITY.md
│
├── js/                     # Frontend modules
├── data/                   # Validated publication data
│   ├── creator-updates.json
│   ├── song-archive.json / song-redirects.json
│   ├── x-translations/     # Reviewed post summaries
│   └── x-posts/            # Manifest + complete collected post shards
├── images/
│   ├── hero/               # Original desktop hero art (source)
│   ├── hero-mobile/        # Original mobile hero art (source)
│   ├── optimized/          # WebP used by production build / Pages
│   ├── icons/
│   └── memes/
├── fonts/
│
├── docs/                   # Start with docs/README.md (not published)
│   ├── MAINTAINER.md       # Release, verification and copy rules
│   ├── CHANGELOG.md
│   ├── SECURITY.md / OPTIMIZATION.md / AI_HANDOFF.md
│   └── history/            # Archived audit / review reports
├── backend/                # Backend service root
├── tools/                  # Commands: tools/README.md; regressions: tests/
├── .github/workflows/      # CI + Pages publish from dist/
│
├── dist/                   # Generated public build (ignored)
├── artifacts/              # Local reports, logs, scans, checks (ignored)
├── .local-notes/           # Private maintenance notes (ignored)
└── inabakumori-site-all-code/ # Committed-text exports (ignored)
```

---

## 🚀 Run Locally

### 📋 Requirements

- **Node.js 24.22.1** (the version pinned in CI)
- npm
- The frontend preview uses Node.js; no Python dependency.
- A working SuperTokens Core / Managed SuperTokens instance only for account and message-wall development

### 1. 📥 Clone the repository

```bash
git clone https://github.com/9178osage/inabakumori-site.git
cd inabakumori-site
```

### 2. 📦 Install frontend tooling dependencies

```bash
npm ci
```

To browse the built frontend, including generated song and post archives, run:

```bash
npm run preview
```

Open `http://127.0.0.1:5500`. Static browsing needs no backend. Account and message-wall requests use the local API at port `3001`; continue below to run it.

### 3. 📦 Install backend dependencies (for API development)

```bash
npm --prefix backend ci
```

### 4. 🔐 Configure backend environment variables

First, copy the example file:

```bash
cp backend/.env.example backend/.env
```

For local development, configure SuperTokens and point the site and API to local addresses. For example:

```env
NODE_ENV=development
HOST=127.0.0.1
API_DOMAIN=http://127.0.0.1:3001
WEBSITE_URL=http://127.0.0.1:5500

SUPERTOKENS_CONNECTION_URI=YOUR_SUPERTOKENS_CONNECTION_URI
SUPERTOKENS_API_KEY=YOUR_SUPERTOKENS_API_KEY
```

Do not commit real API keys to GitHub.

### 5. ⚙️ Start the backend

From the repository root:

```bash
npm run backend
```

Default API address:

```text
http://127.0.0.1:3001
```

### 6. 🌐 Start the frontend

Open another terminal and run this from the repository root:

```bash
npm run preview
```

Then visit:

```text
http://127.0.0.1:5500
```

For source-only editing, `npm run frontend` serves public source files without building. Use `npm run preview` for generated archive pages and pre-rendered content.

---

## ✅ Checks & Build

With both frontend tooling and backend dependencies installed, run all four required checks before committing:

```bash
npm test
npm run check
npm run test:integration
npm run check:changelog
```

`npm run check` runs ESLint, local deployment-table structure checks, tests, backend syntax checks, the production build (including the authentication bundle), and public asset/metadata checks. It does not publish files or verify GitHub records online. `test:integration` starts an isolated test API; `check:changelog` separately queries GitHub Actions. Network, rate-limit, or API errors mean that gate failed. See [the maintainer guide](docs/MAINTAINER.md#核对上线记录表) for coverage and record timing.

Run tests only:

```bash
npm test
```

Build the public production directory:

```bash
npm run build
```

Preview the public build locally (rebuilds `dist/` with `build:local`, which keeps
`http://127.0.0.1:3001` / `http://localhost:3001` in the CSP so it can reach a local backend):

```bash
npm run preview
```

`npm run build:local` does the same build without starting the server. Do not deploy a
`build:local` dist: `npm run build` (used by `npm run check` and GitHub Pages) strips the
localhost entries and `tools/check-build.mjs` fails if they are present.

Other useful commands:

| Command | Purpose |
| --- | --- |
| `npm test` | Run frontend, backend-service, and behavior tests |
| `npm run test:integration` | Exercise the real HTTP API with an isolated temporary database |
| `npm run check:changelog` | Verify deployment records and push coverage against GitHub Actions online |
| `npm run check:links` | Check all recorded external song links |
| `npm run optimize:images` | Generate optimized WebP hero assets |

Check site links:

```bash
npm run check:links
```

Strict mode:

```bash
npm run check:links:strict
```

---

## ☁️ Deployment

The frontend is deployed to **GitHub Pages** by `.github/workflows/pages.yml`. The workflow builds the public directory, runs the release checks, and deploys only `dist/`.

The repository root contains source files, test tools, backend code, and documentation. It must not be used as the Pages artifact.

After pushing to `main`, confirm both **Verify website** and **Publish public site** succeeded for the exact commit, then check the live pages. Verify the separate Vercel deployment and `/healthz` version too. After deployment verification, run `python3 tools/sync-copy.py` and `python3 tools/sync-copy.py --check`, preserving the existing `.review-base`. README and maintenance documents stay in GitHub and are not included in the public build.

Because the account system and message wall are dynamic, they also require a separately hosted Node.js backend configured with:

- `API_DOMAIN`
- `WEBSITE_URL`
- `SUPERTOKENS_CONNECTION_URI`
- `SUPERTOKENS_API_KEY`
- PostgreSQL (`DATABASE_URL`) for production comments and shared rate limits

The production API is `https://inabakumori-backend.vercel.app`, rooted in `backend/` and backed by independent Neon PostgreSQL. The former Railway service was verified against the same PostgreSQL database and then stopped. Local development can still use SQLite; a production rollback must reconnect to the current PostgreSQL database and must not resume writes to the old SQLite copy. See [the migration guide](docs/VERCEL.md) for migration checks and recovery steps.

---

## 🔒 Security & Privacy

The backend includes several baseline protections:

- Helmet HTTP security headers
- CORS origin restrictions
- Authentication rate limiting
- Message endpoint rate limiting
- Guest message limits
- Input length validation
- Message filtering for ads / links / contact information
- Admin permission checks

In production, always keep secrets in environment variables. Never commit `.env`, API keys, or other private credentials to the repository.

---

## ⚠️ Disclaimer

This is an **unofficial, non-commercial fan project**.

Music, MVs, illustrations, character designs, names, trademarks, and any other copyrighted content featured on the site belong to their respective authors, creators, and rights holders.

This project does not claim ownership of any official Inabakumori-related content.

If you are a copyright or rights holder and believe any content on the site should be corrected, credited differently, or removed, please use the contact information provided on the website.

---

## 🤝 Feedback / Contributions

Issues and suggestions are welcome, especially for:

- Incorrect song information
- Broken links
- Bugs
- Translation issues
- Features that would fit the project

Feel free to open an **Issue** or send a suggestion.

---

## ❤️ Finally

There is no grand goal behind this site.

I like Inabakumori, so I made a “Weather Observation Station” — a nod to the title of the second album.

**If even a few people discover and enjoy it, that is already enough.**

☔ **Long live Inabakumori!**

---

<a id="readme-zh"></a>

# 🌧️ 气象观测站 · 稲葉曇

🇺🇸 [English](#readme-en) | 🇨🇳 **中文** | 🇯🇵 [日本語](#readme-ja)

> 一个因为喜欢 **稲葉曇 / Inabakumori** 而做出来的非官方粉丝网站。  
> 整理歌曲及来源、已收录的 X 帖子、NKNK 插画与创作者链接，也提供留言墙与账号功能。

🌐 **在线访问：** [osagechan.top](https://osagechan.top/)

---

## 🌧️ 关于这个项目

**气象观测站** 是一个以稲葉曇为主题的个人粉丝网站。

前端主要使用原生 HTML、CSS 和 JavaScript，没有引入大型前端框架。除了歌曲资料和相关链接，网站还包含多语言、主题切换、响应式布局、账号系统和留言墙等功能。

项目仍在持续更新中。它不追求权威或绝对完整，但会尽量把内容认真整理好。

> This is an unofficial, non-commercial fan project and is not affiliated with Inabakumori, Nukunuku Nigirimeshi, or any official label/platform.

---

## ✨ 主要功能

### 🎵 歌曲资料库

- 稲葉曇歌曲与对应 MV 链接
- 专辑、歌手及其他标签信息
- YouTube 播放量记录及最后检查日期
- 歌名与标签模糊搜索
- 多关键词搜索
- 使用 `+关键词` 指定必须匹配的条件
- 按标签筛选
- 随机选择歌曲
- 搜索结果计数
- 按原始顺序、已记录播放量或曲名排序
- 在当前浏览器保存星标收藏，并筛选只看收藏
- 歌曲档案按专辑或年份浏览；单曲页提供发行资料、制作署名和来源，明确标出未核实信息
- 手机首页先展示精选歌曲，可展开搜索全部歌曲

### 🗂️ 帖子档案与作品动态

- 首页分别展示两位创作者最新收录的一条 X 帖子，并标明本站收录时间
- 帖子档案支持分页、按创作者浏览及继续上次阅读
- 保留原语言正文，部分帖子附中文、英文大意；图片和视频请到原帖查看
- 档案第一页保留 YouTube、pixiv、CAMPFIRE 作品动态，可按创作者筛选
- 收录尚不完整，也不是 X 实时动态；作品来源每天核对，YouTube 播放量每周刷新

### 🖼️ 插画画廊与小日历

- NKNK 插画滚动画廊支持打开大图，手机可双指缩放
- 「神秘小日历」按日本时间显示距最新收录的稲葉曇 YouTube 歌曲发布已过多少天

### 🌐 多语言

目前支持：

- 中文
- English
- 日本語

语言偏好会保存在浏览器本地。

### 🌙 页面与视觉效果

- 明暗主题切换
- 桌面端与移动端响应式布局
- 桌面端与移动端独立背景
- 雨滴效果
- 标题特效
- 连续点击首页标题五次触发的隐藏彩蛋
- 本地保存主题与语言偏好
- Web App Manifest

### 🔗 稲葉曇与 NKNK 相关链接

网站整理了稲葉曇及相关资料在以下平台上的链接：

- YouTube
- X / Twitter
- Niconico
- Bilibili
- Instagram
- TikTok
- Pixiv
- Wikipedia
- Inabakumori Wiki
- VOCALOID Wiki

同时也包含 **ぬくぬくにぎりめし（NKNK）** 的相关页面入口。

### 👤 账号系统

账号与认证功能基于 **SuperTokens**：

- Email / Password 注册
- 登录 / 登出
- Session 管理
- 密码重置

### 💬 留言墙

- 游客与登录用户均可留言
- 登录用户可查看并删除自己的留言
- 分页加载留言
- 管理员审核与管理
- 留言长度限制
- 频率限制
- 基础广告、链接与联系方式过滤
- 游客留言半年过期，登录用户留言长期保留

---

## 🛠️ 技术栈

### 🖥️ Frontend

- HTML5
- CSS3
- Vanilla JavaScript
- SuperTokens Web JS
- esbuild

### ⚙️ Backend

- Node.js 24
- Express 5
- SuperTokens Node
- PostgreSQL（`pg`，生产数据库）
- Node.js built-in SQLite（`node:sqlite`，本地开发与离线备份）
- Helmet
- CORS
- express-rate-limit
- dotenv

---

## 📁 项目结构

```text
inabakumori-site/
├── index.html              # Frontend entry (keep at repo root)
├── updates.html / updates.css # Post archive template and styles
├── calendar.html / calendar.css
├── archive.css             # Song archive styles; HTML is generated in dist/
├── style.css / script.js
├── site.webmanifest
├── robots.txt / sitemap.xml / 404.html
├── package.json / README.md / SECURITY.md
│
├── js/                     # Frontend modules
├── data/                   # Validated publication data
│   ├── creator-updates.json
│   ├── song-archive.json / song-redirects.json
│   ├── x-translations/     # Reviewed post summaries
│   └── x-posts/            # Manifest + complete collected post shards
├── images/
│   ├── hero/               # Original desktop hero art (source)
│   ├── hero-mobile/        # Original mobile hero art (source)
│   ├── optimized/          # WebP used by production build / Pages
│   ├── icons/
│   └── memes/
├── fonts/
│
├── docs/                   # Start with docs/README.md (not published)
│   ├── MAINTAINER.md       # Release, verification and copy rules
│   ├── CHANGELOG.md
│   ├── SECURITY.md / OPTIMIZATION.md / AI_HANDOFF.md
│   └── history/            # Archived audit / review reports
├── backend/                # Backend service root
├── tools/                  # Commands: tools/README.md; regressions: tests/
├── .github/workflows/      # CI + Pages publish from dist/
│
├── dist/                   # Generated public build (ignored)
├── artifacts/              # Local reports, logs, scans, checks (ignored)
├── .local-notes/           # Private maintenance notes (ignored)
└── inabakumori-site-all-code/ # Committed-text exports (ignored)
```

---

## 🚀 本地运行

### 📋 环境要求

- **Node.js 24.22.1**（与 CI 固定版本一致）
- npm
- 前端预览使用 Node.js，无需 Python。
- 联调账号与留言功能时，才需要可用的 SuperTokens Core / Managed SuperTokens 实例

### 1. 📥 克隆仓库

```bash
git clone https://github.com/9178osage/inabakumori-site.git
cd inabakumori-site
```

### 2. 📦 安装前端工具依赖

```bash
npm ci
```

只浏览构建后的前端（包含生成的歌曲与帖子档案），运行：

```bash
npm run preview
```

打开 `http://127.0.0.1:5500`。静态内容无需后端；账号与留言请求本地 `3001` 端口的 API，需要继续按以下步骤启动后端。

### 3. 📦 安装后端依赖（联调 API 时）

```bash
npm --prefix backend ci
```

### 4. 🔐 配置后端环境变量

先复制示例文件：

```bash
cp backend/.env.example backend/.env
```

本地开发时需要正确配置 SuperTokens，并将网站与 API 地址指向本地环境。例如：

```env
NODE_ENV=development
HOST=127.0.0.1
API_DOMAIN=http://127.0.0.1:3001
WEBSITE_URL=http://127.0.0.1:5500

SUPERTOKENS_CONNECTION_URI=YOUR_SUPERTOKENS_CONNECTION_URI
SUPERTOKENS_API_KEY=YOUR_SUPERTOKENS_API_KEY
```

不要把真实 API Key 提交到 GitHub。

### 5. ⚙️ 启动后端

在仓库根目录运行：

```bash
npm run backend
```

默认 API 地址：

```text
http://127.0.0.1:3001
```

### 6. 🌐 启动前端

打开另一个终端，在仓库根目录运行：

```bash
npm run preview
```

然后访问：

```text
http://127.0.0.1:5500
```

仅编辑源码时可用 `npm run frontend`，它只预览公开源文件，不执行构建；生成的档案页和预渲染内容请用 `npm run preview` 查看。

---

## ✅ 检查与构建

安装前端工具与后端两套依赖后，提交前运行全部四项门禁：

```bash
npm test
npm run check
npm run test:integration
npm run check:changelog
```

`npm run check` 包含 ESLint、本地上线记录表结构校验、测试、后端语法检查、生产构建（含认证包）和公开产物／元数据检查，不自动发布，也不联网核对 GitHub 记录。`test:integration` 会启动隔离测试 API；`check:changelog` 单独查询 GitHub Actions，网络、限流或 API 错误均视为该门禁失败。覆盖范围和补记时机见[站长手册](docs/MAINTAINER.md#核对上线记录表)。

只运行测试：

```bash
npm test
```

构建公开生产目录：

```bash
npm run build
```

本地预览公开产物（会先用 `build:local` 重新构建 `dist/`，CSP 保留
`http://127.0.0.1:3001` / `http://localhost:3001`，可连接本地后端）：

```bash
npm run preview
```

`npm run build:local` 只构建不启动服务。不要部署 `build:local` 的产物：`npm run build`
（`npm run check` 和 GitHub Pages 使用）会去掉 localhost，`tools/check-build.mjs` 发现残留会报错。

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm test` | 运行前端、后端服务和交互测试 |
| `npm run test:integration` | 使用独立临时数据库验证真实 HTTP 接口 |
| `npm run check:changelog` | 联网核对 GitHub Actions 上线记录及推送覆盖范围 |
| `npm run check:links` | 检查歌曲资料中的外部链接 |
| `npm run optimize:images` | 生成优化后的 WebP 背景资源 |

检查已记录的外部歌曲链接：

```bash
npm run check:links
```

严格模式：

```bash
npm run check:links:strict
```

---

## ☁️ 部署说明

前端由 `.github/workflows/pages.yml` 自动构建并部署到 **GitHub Pages**。工作流会运行发布前检查，只把 `dist/` 作为公开构建产物。

仓库根目录包含源代码、测试工具、后端和文档，不能直接作为 Pages 静态目录。

推送 `main` 后，须确认同一提交的 **Verify website** 与 **Publish public site** 均成功，再核对线上页面；另行确认 Vercel 部署及 `/healthz` 版本。部署验证完成后运行 `python3 tools/sync-copy.py` 及其 `--check`，保留现有 `.review-base`。README 和维护文档保存在 GitHub，不包含在网站公开产物中。

账号系统和留言墙属于动态功能，因此还需要单独部署 Node.js 后端，并配置：

- `API_DOMAIN`
- `WEBSITE_URL`
- `SUPERTOKENS_CONNECTION_URI`
- `SUPERTOKENS_API_KEY`
- PostgreSQL（`DATABASE_URL`），保存生产留言和共享限流计数

生产 API 为 `https://inabakumori-backend.vercel.app`，以 `backend/` 为服务根目录，连接独立 Neon PostgreSQL。原 Railway 服务已连接同一 PostgreSQL 并核验，随后停止。本地开发仍可使用 SQLite；生产回退必须连接当前 PostgreSQL，不能恢复旧 SQLite 写入。迁移核对与恢复步骤见 [Vercel 迁移说明](docs/VERCEL.md)。

---

## 🔒 安全与隐私

后端目前包含以下基础保护：

- Helmet HTTP 安全头
- CORS Origin 限制
- 登录接口频率限制
- 留言接口频率限制
- 游客留言频率限制
- 输入长度验证
- 留言广告 / 链接 / 联系方式过滤
- 管理员权限检查

生产环境部署时，请始终通过环境变量保存密钥，不要把 `.env`、API Key 或其他私密信息提交到仓库。

---

## ⚠️ 免责声明

这是一个 **非官方、非商业粉丝项目**。

网站中涉及的音乐、MV、插画、人物形象、名称、商标以及其他受版权保护的内容，其权利均归各自的作者、创作者和权利人所有。

本项目不声称拥有任何官方稲葉曇相关内容。

如果你是相关版权方或权利人，并认为本站中的内容需要修改、补充署名或删除，请通过网站中的联系方式联系。

---

## 🤝 Feedback / Contributions

如果你发现以下问题，或者有新的想法，欢迎提交 **Issue** 或提出建议：

- 歌曲资料有误
- 链接失效
- 页面出现 Bug
- 翻译需要修改
- 有适合加入的新功能

---

## ❤️ 最后

这个网站没有什么宏大的目标。

只是因为喜欢稲葉曇，所以做了一个“气象观测站”（致敬第二张专辑名）。

**有人愿意点进来看看，就已经很好了。**

☔ **稲葉曇万岁！**

---

<a id="readme-ja"></a>

# 🌧️ 気象観測所 · 稲葉曇

🇺🇸 [English](#readme-en) | 🇨🇳 [中文](#readme-zh) | 🇯🇵 **日本語**

> **稲葉曇 / Inabakumori** が好きで作った、非公式のファンサイトです。  
> 楽曲と出典、収集済みの X 投稿、NKNK のイラスト、関連リンクをまとめ、メッセージウォールやアカウント機能も用意しています。

🌐 **サイトを見る：** [osagechan.top](https://osagechan.top/)

---

## 🌧️ このプロジェクトについて

**気象観測所** は、稲葉曇をテーマにした個人制作のファンサイトです。

フロントエンドは主に素の HTML、CSS、JavaScript で構成し、大規模なフレームワークは使用していません。楽曲情報や関連リンクに加え、多言語対応、テーマ切り替え、レスポンシブレイアウト、アカウント機能、メッセージウォールなどを実装しています。

このプロジェクトは現在も更新中です。網羅性や専門性を目的としたものではありませんが、できるだけ丁寧に情報を整理しています。

> This is an unofficial, non-commercial fan project and is not affiliated with Inabakumori, Nukunuku Nigirimeshi, or any official label/platform.

---

## ✨ 主な機能

### 🎵 楽曲ライブラリ

- 稲葉曇の楽曲と対応する MV へのリンク
- アルバム、ボーカルなどのタグ情報
- YouTube 再生回数と最終確認日の記録
- 曲名・タグのあいまい検索
- 複数キーワード検索
- `+キーワード` で必須条件を指定
- タグによる絞り込み
- ランダム選曲
- 検索結果件数の表示
- 元の順序・記録済み再生回数・曲名で並べ替え
- このブラウザーに星付きのお気に入りを保存し、絞り込み表示
- 楽曲アーカイブをアルバムまたは年で絞り込み、個別ページで発売情報・クレジット・出典を確認（未確認の情報は明記）
- モバイルでは選曲リストから始め、展開して全曲を検索

### 🗂️ 投稿アーカイブ・作品情報

- ホームには各クリエイターの最新収集済み X 投稿を 1 件ずつ、収集日時とともに表示
- ページ分割された投稿アーカイブ、クリエイター別表示、前回の読書位置への復帰
- 原文を保持し、一部に中国語・英語の要約を掲載（画像・動画は元の投稿で閲覧）
- アーカイブの最初のページに YouTube・pixiv・CAMPFIRE の作品情報を掲載し、クリエイターで絞り込み
- 収集は未完了で、X のリアルタイムフィードではありません。作品の出典は毎日、YouTube 再生回数は毎週確認

### 🖼️ ギャラリー・小さなカレンダー

- NKNK のイラストをスクロール式ギャラリーで閲覧し、大きな画像を開く（モバイルではピンチズームに対応）
- 「ひみつの小さなカレンダー」で、最新収集済みの稲葉曇の YouTube 楽曲公開からの日数を日本時間で表示

### 🌐 多言語対応

現在対応している言語：

- 中文
- English
- 日本語

選択した言語はブラウザに保存されます。

### 🌙 UI・ビジュアル

- ライト / ダークテーマ切り替え
- PC / モバイル対応のレスポンシブレイアウト
- PC 用 / モバイル用の個別背景
- 雨のエフェクト
- タイトルエフェクト
- タイトルを5回連続でクリックすると現れる隠しイースターエッグ
- テーマと言語設定をローカルに保存
- Web App Manifest

### 🔗 稲葉曇・NKNK 関連リンク

稲葉曇や関連情報について、以下のサービスへのリンクをまとめています：

- YouTube
- X / Twitter
- Niconico
- Bilibili
- Instagram
- TikTok
- Pixiv
- Wikipedia
- Inabakumori Wiki
- VOCALOID Wiki

**ぬくぬくにぎりめし（NKNK）** に関連するページへのリンクも掲載しています。

### 👤 アカウント機能

アカウント認証には **SuperTokens** を使用しています：

- メールアドレス / パスワードでの登録
- ログイン / ログアウト
- セッション管理
- パスワードリセット

### 💬 メッセージウォール

- ゲスト / ログインユーザーの投稿
- ログインユーザーは自分の投稿を確認・削除可能
- ページネーションによる読み込み
- 管理者向けの投稿管理
- 投稿文字数制限
- レート制限
- 基本的なスパム、リンク、連絡先情報のフィルタリング
- ゲスト投稿は6か月（半年）で期限切れ、ログイン投稿は保持

---

## 🛠️ 技術スタック

### 🖥️ Frontend

- HTML5
- CSS3
- Vanilla JavaScript
- SuperTokens Web JS
- esbuild

### ⚙️ Backend

- Node.js 24
- Express 5
- SuperTokens Node
- PostgreSQL（`pg`、本番データベース）
- Node.js built-in SQLite（`node:sqlite`、ローカル開発とオフラインバックアップ）
- Helmet
- CORS
- express-rate-limit
- dotenv

---

## 📁 プロジェクト構成

```text
inabakumori-site/
├── index.html              # Frontend entry (keep at repo root)
├── updates.html / updates.css # Post archive template and styles
├── calendar.html / calendar.css
├── archive.css             # Song archive styles; HTML is generated in dist/
├── style.css / script.js
├── site.webmanifest
├── robots.txt / sitemap.xml / 404.html
├── package.json / README.md / SECURITY.md
│
├── js/                     # Frontend modules
├── data/                   # Validated publication data
│   ├── creator-updates.json
│   ├── song-archive.json / song-redirects.json
│   ├── x-translations/     # Reviewed post summaries
│   └── x-posts/            # Manifest + complete collected post shards
├── images/
│   ├── hero/               # Original desktop hero art (source)
│   ├── hero-mobile/        # Original mobile hero art (source)
│   ├── optimized/          # WebP used by production build / Pages
│   ├── icons/
│   └── memes/
├── fonts/
│
├── docs/                   # Start with docs/README.md (not published)
│   ├── MAINTAINER.md       # Release, verification and copy rules
│   ├── CHANGELOG.md
│   ├── SECURITY.md / OPTIMIZATION.md / AI_HANDOFF.md
│   └── history/            # Archived audit / review reports
├── backend/                # Backend service root
├── tools/                  # Commands: tools/README.md; regressions: tests/
├── .github/workflows/      # CI + Pages publish from dist/
│
├── dist/                   # Generated public build (ignored)
├── artifacts/              # Local reports, logs, scans, checks (ignored)
├── .local-notes/           # Private maintenance notes (ignored)
└── inabakumori-site-all-code/ # Committed-text exports (ignored)
```

---

## 🚀 ローカルで実行する

### 📋 必要な環境

- **Node.js 24.22.1**（CI と同じ固定バージョン）
- npm
- フロントエンドのプレビューには Node.js を使用します。Python は不要です。
- アカウント・メッセージ機能の開発時のみ、利用可能な SuperTokens Core / Managed SuperTokens インスタンス

### 1. 📥 リポジトリをクローン

```bash
git clone https://github.com/9178osage/inabakumori-site.git
cd inabakumori-site
```

### 2. 📦 フロントエンド用ツール依存関係をインストール

```bash
npm ci
```

生成された楽曲・投稿アーカイブを含むフロントエンドを閲覧するには：

```bash
npm run preview
```

`http://127.0.0.1:5500` を開きます。静的な閲覧にバックエンドは不要です。アカウント・メッセージ機能はローカルの `3001` ポートへ接続するため、以下の手順で API を起動してください。

### 3. 📦 バックエンド依存関係をインストール（API 開発時）

```bash
npm --prefix backend ci
```

### 4. 🔐 バックエンドの環境変数を設定

まずサンプルファイルをコピーします：

```bash
cp backend/.env.example backend/.env
```

ローカル開発では、SuperTokens を設定し、Web サイトと API の URL をローカル環境向けに変更します。例：

```env
NODE_ENV=development
HOST=127.0.0.1
API_DOMAIN=http://127.0.0.1:3001
WEBSITE_URL=http://127.0.0.1:5500

SUPERTOKENS_CONNECTION_URI=YOUR_SUPERTOKENS_CONNECTION_URI
SUPERTOKENS_API_KEY=YOUR_SUPERTOKENS_API_KEY
```

実際の API キーを GitHub にコミットしないでください。

### 5. ⚙️ バックエンドを起動

リポジトリのルートで実行：

```bash
npm run backend
```

デフォルトの API アドレス：

```text
http://127.0.0.1:3001
```

### 6. 🌐 フロントエンドを起動

別のターミナルを開き、リポジトリのルートで実行：

```bash
npm run preview
```

その後、以下にアクセスします：

```text
http://127.0.0.1:5500
```

ソースだけを編集する場合は `npm run frontend` で公開ソースをプレビューできます。生成されたアーカイブや事前描画コンテンツの確認には `npm run preview` を使ってください。

---

## ✅ チェックとビルド

フロントエンド用ツールとバックエンドの依存関係を両方インストールし、コミット前に必要な 4 つのチェックをすべて実行：

```bash
npm test
npm run check
npm run test:integration
npm run check:changelog
```

`npm run check` は ESLint、公開記録表のローカル構造確認、テスト、バックエンドの構文確認、本番ビルド（認証バンドルを含む）、公開成果物・メタデータの確認を行います。公開や GitHub 記録のオンライン照合は行いません。`test:integration` は隔離したテスト API を起動し、`check:changelog` は別途 GitHub Actions を照合します。通信・レート制限・API のエラーも失敗として扱います。範囲と追記のタイミングは[管理者ガイド](docs/MAINTAINER.md#核对上线记录表)を参照してください。

テストのみ：

```bash
npm test
```

公開用の本番ディレクトリ `dist/` をビルド：

```bash
npm run build
```

公開ビルドをローカルでプレビュー（`build:local` で `dist/` を再生成し、CSP に
`http://127.0.0.1:3001` / `http://localhost:3001` を残すのでローカルのバックエンドに接続できます）：

```bash
npm run preview
```

`build:local` の成果物はデプロイしないでください。`npm run build`（`npm run check` と GitHub Pages）は
localhost を除去し、残っていれば `tools/check-build.mjs` が失敗します。

記録済みの楽曲の外部リンクをチェック：

```bash
npm run check:links
```

厳格モード：

```bash
npm run check:links:strict
```

---

## ☁️ デプロイ

フロントエンドは `.github/workflows/pages.yml` でビルドし、公開用の `dist/` のみを **GitHub Pages** にデプロイします。リポジトリのルートをそのまま公開しないでください。

`main` へ push 後、同じコミットの **Verify website** と **Publish public site** の成功、公開ページ、別途 Vercel のデプロイと `/healthz` のバージョンを確認します。その後、`python3 tools/sync-copy.py` と `python3 tools/sync-copy.py --check` を実行し、既存の `.review-base` を保持します。README と管理用文書は GitHub に保存され、公開ビルドには含まれません。

アカウント機能とメッセージウォールは動的機能のため、別途 Node.js バックエンドをデプロイし、以下を設定する必要があります：

- `API_DOMAIN`
- `WEBSITE_URL`
- `SUPERTOKENS_CONNECTION_URI`
- `SUPERTOKENS_API_KEY`
- PostgreSQL（`DATABASE_URL`）：本番コメントと共有レート制限のカウンターを保存

本番 API は `https://inabakumori-backend.vercel.app` です。`backend/` をサービスルートとし、独立した Neon PostgreSQL に接続します。旧 Railway サービスは同じ PostgreSQL への接続を検証した後に停止しました。ローカル開発では SQLite を使えますが、本番を切り戻す場合は現在の PostgreSQL に接続し、古い SQLite への書き込みを再開しないでください。移行時の確認と復旧手順は[移行ガイド](docs/VERCEL.md)を参照してください。

---

## 🔒 セキュリティとプライバシー

バックエンドには、以下の基本的な保護機能があります：

- Helmet による HTTP セキュリティヘッダー
- CORS Origin 制限
- 認証エンドポイントのレート制限
- メッセージ投稿のレート制限
- ゲスト / ログインユーザーの投稿制限
- 入力文字数の検証
- 広告 / リンク / 連絡先情報のフィルタリング
- 管理者権限チェック

本番環境では、秘密情報を必ず環境変数で管理してください。`.env`、API キー、その他の機密情報をリポジトリにコミットしないでください。

---

## ⚠️ 免責事項

これは **非公式・非営利のファンプロジェクト** です。

サイト内の音楽、MV、イラスト、キャラクターデザイン、名称、商標、その他の著作物に関する権利は、それぞれの作者・クリエイター・権利者に帰属します。

本プロジェクトは、稲葉曇に関する公式コンテンツの権利を主張するものではありません。

著作権者・権利者の方で、掲載内容の修正、クレジット変更、削除をご希望の場合は、サイト内の連絡先からご連絡ください。

---

## 🤝 フィードバック / コントリビューション

以下のような点に気づいた場合や、追加したいアイデアがある場合は、Issue や提案を歓迎します：

- 楽曲情報の誤り
- リンク切れ
- バグ
- 翻訳の修正
- このプロジェクトに合いそうな新機能

---

## ❤️ 最後に

このサイトに、大げさな目標はありません。

稲葉曇が好きだから、「気象観測所」を作りました（2ndアルバムのタイトルにちなんだ名前です）。

**誰かが見つけて楽しんでくれたら、それだけで十分です。**

☔ **稲葉曇万歳！**
