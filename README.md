# 🌧️ 气象观测站 · 稲葉曇

🇨🇳 **中文** | 🇺🇸 [English](README_EN.md) | 🇯🇵 [日本語](README_JA.md)

> 一个因为太喜欢 **稲葉曇 / Inabakumori** 而做出来的非官方粉丝网站。  
> 收集歌曲、MV、相关创作者链接，并提供留言墙与账号功能。

🌐 **在线访问：** https://9178osage.github.io/inabakumori-site/

---

## 🌧️ 关于这个项目

**气象观测站** 是一个以稲葉曇为主题的个人粉丝网站。

网站以原生 HTML、CSS 和 JavaScript 为主，没有使用大型前端框架。除了歌曲资料和相关链接，也加入了多语言、主题切换、响应式界面、账号系统和留言墙等功能。

这个项目仍在持续更新中。内容不一定专业或完整，但都是认真整理的。

> This is an unofficial, non-commercial fan project and is not affiliated with Inabakumori, Nukunuku Nigirimeshi, or any official label/platform.

---

## ✨ 主要功能

### 🎵 歌曲资料库

- 稲葉曇歌曲与 MV 链接
- 专辑、歌手等标签信息
- YouTube 播放量记录与检查日期
- 歌名 / 标签模糊搜索
- 多关键词搜索
- 使用 `+关键词` 设置必须匹配的条件
- 标签筛选
- 随机歌曲
- 搜索结果计数

### 🌐 多语言

目前支持：

- 中文
- English
- 日本語

语言选择会保存在浏览器中。

### 🌙 页面与视觉效果

- 明暗主题切换
- 桌面端 / 移动端响应式布局
- 桌面与手机版背景
- 点击切换背景
- 雨滴效果
- 标题视觉效果
- 主题与语言偏好保存
- Web App Manifest

### 🔗 稲葉曇与 NKNK 相关链接

网站整理了包括以下平台在内的相关链接：

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

账号功能基于 **SuperTokens**：

- Email / Password 注册
- 登录 / 登出
- Session 管理
- 忘记密码 / 密码重置

### 💬 留言墙

- 游客留言
- 登录用户留言
- 登录用户查看自己的留言
- 删除自己的留言
- 分页加载
- 管理员留言管理
- 留言长度限制
- 频率限制
- 基础垃圾广告 / 联系方式过滤
- 游客留言自动过期机制

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
- Node.js built-in SQLite (`node:sqlite`)
- Helmet
- CORS
- express-rate-limit
- dotenv

---

## 📁 项目结构

```text
inabakumori-site/
├── index.html
├── style.css
├── script.js
├── site.webmanifest
├── robots.txt
├── package.json
│
├── js/
│   ├── auth.js
│   ├── comments.js
│   ├── config.js
│   ├── i18n.js
│   └── songs.js
│
├── images/
├── fonts/
│
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── server.mjs
│   └── services.mjs
│
└── tools/
```

---

## 🚀 本地运行

### 📋 环境要求

- **Node.js 24.x**
- npm
- Python 3（仓库当前的前端本地服务器脚本使用 `python3 -m http.server`）
- 可用的 SuperTokens Core / Managed SuperTokens 实例

### 1. 📥 克隆仓库

```bash
git clone https://github.com/9178osage/inabakumori-site.git
cd inabakumori-site
```

### 2. 📦 安装前端工具依赖

```bash
npm install
```

### 3. 📦 安装后端依赖

```bash
cd backend
npm install
cd ..
```

### 4. 🔐 配置后端环境变量

先复制示例文件：

```bash
cp backend/.env.example backend/.env
```

本地开发时至少需要正确配置 SuperTokens，并将网站/API 地址设为本地地址。例如：

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
npm run frontend
```

然后访问：

```text
http://127.0.0.1:5500
```

---

## ✅ 检查与构建

运行测试并重新构建认证脚本：

```bash
npm run check
```

只运行测试：

```bash
npm test
```

重新构建 `js/auth.js`：

```bash
npm run build
```

检查站内链接：

```bash
npm run check:links
```

严格模式：

```bash
npm run check:links:strict
```

---

## ☁️ 部署说明

前端可以作为静态网站部署，例如使用 **GitHub Pages**。

账号和留言墙属于动态功能，因此还需要单独运行 Node.js 后端，并配置：

- `API_DOMAIN`
- `WEBSITE_URL`
- `SUPERTOKENS_CONNECTION_URI`
- `SUPERTOKENS_API_KEY`
- 持久化的 SQLite 数据目录

仓库中的后端已经包含 Railway 持久化 Volume 相关处理；生产环境下请确保数据库文件位于持久化存储中，而不是临时文件系统。

---

## 🔒 安全与隐私

后端目前包含一些基础保护：

- Helmet HTTP 安全头
- CORS Origin 限制
- 登录接口频率限制
- 留言接口频率限制
- 游客留言限制
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

如果你发现：

- 歌曲资料有错误
- 链接失效
- 页面出现 Bug
- 翻译需要修改
- 有适合加入的新功能

欢迎提交 **Issue** 或提出建议。

---

## ❤️ 最后

这个网站没有什么很复杂的目标。

只是因为喜欢稲葉曇，所以想做一个属于自己的气象观测站。

**有人看到，就已经很好了。**

☔ **稲葉曇万岁！**
