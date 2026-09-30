# 给接手 AI 的项目交接说明

整理日期：2026-09-29。本文基于本地文件、Git 状态和本次线上检查结果；不包含任何密钥、密码或数据库内容。

## 用户意图与当前状态

用户希望后续工作交给其他工具里的 AI。具体下一项开发任务尚未指定，请接手后向用户确认任务，不要把本文当成新增功能需求。

- 项目目录：`/Users/zihaoma/Desktop/inabakumori-site`
- 当前分支：`main`
- 本文可随优化提交一并纳入版本库（不含密钥）。
- 2026-09-29 已落地：电话/微信审核收紧、API CSP、前后端码点长度对齐、游客同文短窗去重、删除死路径 `songMatchesTags`。
- 播放量批量刷新需 YouTube Data API 密钥；仓库与本机未配置时请跳过，勿伪造数字。
- 推送 `main` 后 Railway 通常自动部署；用 `/healthz` 确认。

## 项目概况

“气象观测站”是稲葉曇 / Inabakumori 非官方粉丝网站。原生 HTML、CSS、JavaScript 前端，含中英日三语、歌曲搜索、主题与背景切换、SuperTokens 账号系统和留言墙。

后端使用 Node.js 24、Express 5、SuperTokens 和 Node 内置 SQLite。仓库当前没有依赖本地 `.env`、留言数据库或其他私密文件才能运行 GitHub Pages 前端。

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
| `docs/OPTIMIZATION.md` | 优化与运维说明 |
| `docs/AI_HANDOFF.md` | 本文（AI 交接说明） |

## 本地运行与检查

环境要求：Node.js 24.x、npm、Python 3。账号功能需要可用的 SuperTokens 服务。

在项目根目录安装依赖：

```sh
npm install
npm --prefix backend install
```

参考 `backend/.env.example` 配置后端；若已有 `backend/.env`，保留现有内容，不要直接覆盖。不要读取、打印或提交其中的 SuperTokens 密钥、管理员邮箱或其他私密值。本次交接未读取私密环境变量或数据库。

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

`npm run check` 会依次执行测试和前端认证脚本构建；`npm run check:links` 与 `npm run check:links:strict` 用于检查链接。

## 部署相关信息

- 前端地址：`https://9178osage.github.io/inabakumori-site/`
- `js/config.js` 在 localhost / 127.0.0.1 下连接当前主机的 3001 端口，其他域名下连接 `https://inabakumori-site-production.up.railway.app`。
- 后端公网地址：`https://inabakumori-site-production.up.railway.app`
- Railway 服务使用 `/backend` 作为根目录，启动命令为 `npm start`，健康检查路径为 `/healthz`，SQLite 数据位于 Railway 持久化卷的 `/data/comments.db`。
- 本次线上检查：`/healthz` 返回 HTTP 200，留言接口返回 HTTP 200 并读取到 4 条留言。
- GitHub 提交已触发 Railway 自动部署。构建日志显示 `npm install` 成功并报告 `found 0 vulnerabilities`；用户已确认 Railway 中 `Upgrade Nodemailer to 10.0.2` 部署状态为 `Active`。

## 最近检查结果

- `npm test`：56 项通过。
- `npm --prefix backend run check`：通过。
- 后端 Nodemailer 已从 9.1.1 升级到 10.0.2，相关锁文件已同步。
- 本地 `npm audit` 在升级后报告 0 个已知漏洞；如果当前网络无法访问 npm 漏洞接口，审计命令可能因 DNS 或网络失败，不能把网络错误当成漏洞结果。
- 找回密码邮件只验证了邮件内容生成，没有发送真实邮件；实际收件仍需用户用自己的邮箱测试。

## 接手建议

先阅读本文和与用户下一项需求相关的代码，再确认当前 Git 状态。按实际需求修改并执行相应检查。保留现有未提交改动，勿提交 `.env`、密钥或数据库；这些项目已有相应忽略规则。用户已授权推送 GitHub；Railway 通常由 GitHub 推送自动部署，部署后检查 `/healthz`。
