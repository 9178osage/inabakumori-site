# 给接手 AI 的项目交接说明

整理日期：2026-10-01（在 2026-09-29 交接基础上续写；2026-10-11 更新文档结构）。本文基于本地文件、Git 状态和本次线上检查结果；不包含任何密钥、密码或数据库内容。

## 用户意图与当前状态

2026-10-23：后端迁往 `https://inabakumori-backend.vercel.app`，使用 Vercel 的 `inabakumori-backend` 项目及独立 Neon 免费 PostgreSQL。最终快照的 13 条留言已逐字段核对，保留原 ID、会员归属和历史序列；SuperTokens Core 与管理员 ID 保持一致。迁移与回退步骤见 [VERCEL.md](VERCEL.md)。回退旧入口时须使用同一 PostgreSQL，不能恢复旧 SQLite 写入。每次仍须核对线上配置、对应部署及 `/healthz`，不能把 Git 推送等同已发布。

运维分工（2026-10-24 维护者确认）：独立异地备份主机、每日巡检及每日备份由另一助手管理，已改为 Vercel 地址并手动验证成功。本地执行者不再寻找或接管该主机；现有 Mac 每日备份保持原配置，除非维护者另有明确要求。

2026-10-11 安全更新：管理员**只**通过 `ADMIN_USER_IDS`（SuperTokens user ID，逗号分隔）授权，`ADMIN_EMAILS` 已彻底移除；不要恢复按邮箱授权。`/healthz` 只公开 `{ ok, version }`（当前优先取 `VERCEL_GIT_COMMIT_SHA` 前 7 位，兼容 Railway 提交变量）。当前安全状态、后端变量、备份与 DNS 清单见 [SECURITY.md](SECURITY.md)；审查过程归档在 [history/](history/)。新域名为 `https://osagechan.top`。新增解析前总请求限流，并修复 DELETE 大小写路径限流绕过。

用户曾授权对站点做一轮综合优化并可推送 `origin/main`。接手后仍应先确认下一项任务，不要把本文当成新增功能需求。

- 项目目录：`<repo-dir>`（维护者本机的仓库克隆）
- 当前分支：`main`
- 本文可随优化提交一并纳入版本库（不含密钥）。
- 2026-09-29 已落地：电话/微信审核收紧、API CSP、前后端码点长度对齐、游客同文短窗去重、删除死路径 `songMatchesTags`。
- 2026-10-01 已落地：静态/首页 CSP 与安全头、DELETE 限流、healthz（2026-10-11 起改为只返回 `ok` 与 `version`）、Permissions-Policy、axios 审计修复、a11y/焦点/SEO 微调、留言墙 `aria-busy`、主题色首屏同步。彩蛋仍为首页标题点击 5 次。
- 播放量批量刷新需 YouTube Data API 密钥；仓库与本机未配置时请跳过，勿伪造数字。
- 推送 `main` 后 Vercel 和 Pages 工作流会分别部署；用 Vercel `/healthz` 的 `version`（应等于新提交的前 7 位）与 Pages URL 确认。

## 项目概况

“气象观测站”是稲葉曇 / Inabakumori 非官方粉丝网站。原生 HTML、CSS、JavaScript 前端，含中英日三语、歌曲搜索、主题与背景切换、SuperTokens 账号系统和留言墙。

后端使用 Node.js 24、Express 5、SuperTokens，生产使用 PostgreSQL；SQLite 用于本地开发和离线快照。旧 Railway 服务也已迁到同一 PostgreSQL 并停止，不能恢复旧 SQLite 写入。仓库当前没有依赖本地 `.env`、留言数据库或其他私密文件才能运行 GitHub Pages 前端。

## 文件入口

| 文件 | 用途 |
| --- | --- |
| `index.html` | 页面结构 |
| `style.css` | 页面样式 |
| `script.js` | 主要页面交互 |
| `js/config.js` | API 地址和移动端背景配置 |
| `js/i18n.js` | 多语言内容 |
| `js/songs.js` | 歌曲资料 |
| `js/comments.js` | 留言墙前端 |
| `tools/auth-src.js` | 账号功能源文件 |
| `js/auth.js` | 构建生成的账号功能脚本，应修改源文件后重新构建 |
| `backend/server.mjs` | 后端服务入口 |
| `backend/services.mjs` | 后端辅助逻辑 |
| `backend/.env.example` | 后端环境变量示例 |
| `tools/tests/*.test.cjs` | 现有自动化测试 |
| `tools/check-links.mjs` | 链接检查工具 |
| `images/`、`fonts/` | 本地图片与字体；线上背景用 `images/optimized/`，原始稿在 `images/hero/` 与 `images/hero-mobile/` |
| `docs/SECURITY.md` | 当前安全状态与运维清单（唯一当前参考） |
| `docs/history/` | 2026-10-11 安全审查与部署复核归档 |
| `SECURITY.md` | 漏洞报告方式 |
| `NKNK/` | NKNK 画廊原图（`npm run generate:nknk` 生成 `images/optimized/nknk/`，不发布） |
| `docs/OPTIMIZATION.md` | 优化与运维说明 |
| `docs/AI_HANDOFF.md` | 本文（AI 交接说明） |

## 本地运行与检查

环境要求：Node.js 24.22.1（与 CI 固定版本一致）、npm。账号功能需要可用的 SuperTokens 服务。前端预览不再依赖 Python。

在项目根目录安装依赖：

```sh
npm install
npm --prefix backend install
```

参考 `backend/.env.example` 配置后端；若已有 `backend/.env`，保留现有内容，不要直接覆盖。不要读取、打印或提交其中的 SuperTokens 密钥、管理员 user ID、备份令牌或其他私密值。本次交接未读取私密环境变量或数据库。

分别在两个终端中运行：

```sh
npm run backend
```

```sh
npm run frontend
```

前端默认地址为 `http://127.0.0.1:5500`，API 默认端口为 `3001`。

按改动范围使用现有检查：

```sh
npm test
npm run build
npm --prefix backend run check
```

本地连本地后端预览产物用 `npm run preview`（内部 `npm run build:local`，CSP 保留 localhost:3001；该产物勿部署）。部署/CI 只用 `npm run build`，它会去掉 localhost，`check-build` 会强制校验。

`npm run check` 会依次执行测试和前端认证脚本构建；`npm run check:links` 与 `npm run check:links:strict` 用于检查链接。

## 部署相关信息

- 前端地址：`https://osagechan.top/`（自定义域名，仓库根目录 `CNAME`；旧地址 `https://9178osage.github.io/inabakumori-site/` 由 GitHub 301 跳转到新域名）
- `js/config.js` 在 localhost / 127.0.0.1 下连接当前主机的 3001 端口，其他域名下连接 `https://inabakumori-backend.vercel.app`。
- 后端公网地址：`https://inabakumori-backend.vercel.app`。
- Vercel 项目根目录为 `backend`，Express 默认导出应用，使用 `DATABASE_URL` 连接 Neon PostgreSQL。旧 Railway 服务连接同一 PostgreSQL 并核验后已停止，源码配置与卷保留；重新启动时须先核对同一 PostgreSQL 和接口行为，再恢复前端旧地址，不能恢复旧 SQLite 写入。
- Pages 发布源为 GitHub Actions（`Publish public site` 工作流）；`main` 有 ruleset `protect-main`（禁止删除与 force push）。
- 推送 `main` 分别触发 Vercel 与 Pages 部署；核实 GitHub 两条工作流、Vercel 部署 Ready 和 `/healthz` 对应的提交版本。

## 最近检查结果

- `npm test`：以当前 `tools/tests` 为准（2026-10-11 为 113 项）。
- `npm --prefix backend run check`：通过。
- 后端 Nodemailer 已升级到 10.x；2026-10-01 另修复传递依赖 axios 高危审计项。
- 本地 `npm audit` 在升级后报告 0 个已知漏洞；如果当前网络无法访问 npm 漏洞接口，审计命令可能因 DNS 或网络失败，不能把网络错误当成漏洞结果。
- 找回密码邮件只验证了邮件内容生成，没有发送真实邮件；实际收件仍需用户用自己的邮箱测试。

## 接手建议

先阅读本文和与用户下一项需求相关的代码，再确认当前 Git 状态。按实际需求修改并执行相应检查。保留现有未提交改动，勿提交 `.env`、密钥或数据库；这些项目已有相应忽略规则。用户已授权推送 GitHub；按站长手册核对 GitHub Pages 与 Vercel 的发布结果、线上配置和 `/healthz`，然后同步并校验文本副本。
