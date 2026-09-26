<a id="readme-en"></a>

# 🌧️ Weather Observation Station · 稲葉曇

🇺🇸 **English** | 🇨🇳 [中文](#readme-zh) | 🇯🇵 [日本語](#readme-ja)

> An unofficial fan site made out of a love for **稲葉曇 / Inabakumori**.  
> It brings together songs, MVs, related creator links, plus a message wall and account features.

🌐 **Live site:** https://9178osage.github.io/inabakumori-site/

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
- Click or tap to cycle through backgrounds
- Rain effects
- Title effects
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
- Node.js built-in SQLite (`node:sqlite`)
- Helmet
- CORS
- express-rate-limit
- dotenv

---

## 📁 Project Structure

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

## 🚀 Run Locally

### 📋 Requirements

- **Node.js 24.x**
- npm
- Python 3 (the current frontend dev server uses `python3 -m http.server`)
- A working SuperTokens Core / Managed SuperTokens instance

### 1. 📥 Clone the repository

```bash
git clone https://github.com/9178osage/inabakumori-site.git
cd inabakumori-site
```

### 2. 📦 Install frontend tooling dependencies

```bash
npm install
```

### 3. 📦 Install backend dependencies

```bash
cd backend
npm install
cd ..
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
npm run frontend
```

Then visit:

```text
http://127.0.0.1:5500
```

---

## ✅ Checks & Build

Run tests and rebuild the authentication bundle:

```bash
npm run check
```

Run tests only:

```bash
npm test
```

Rebuild `js/auth.js`:

```bash
npm run build
```

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

The frontend can be deployed as a static site, for example with **GitHub Pages**.

Because the account system and message wall are dynamic, they also require a separately hosted Node.js backend configured with:

- `API_DOMAIN`
- `WEBSITE_URL`
- `SUPERTOKENS_CONNECTION_URI`
- `SUPERTOKENS_API_KEY`
- Persistent SQLite storage

The backend already includes support for Railway persistent Volumes. In production, keep the database on persistent storage rather than an ephemeral filesystem.

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
> 整理歌曲、MV、相关创作者链接，也提供留言墙与账号功能。

🌐 **在线访问：** https://9178osage.github.io/inabakumori-site/

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
- 点击或轻触切换背景
- 雨滴效果
- 标题特效
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
- 游客与登录用户均可留言自动过期机制

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

账号系统和留言墙属于动态功能，因此还需要单独部署 Node.js 后端，并配置：

- `API_DOMAIN`
- `WEBSITE_URL`
- `SUPERTOKENS_CONNECTION_URI`
- `SUPERTOKENS_API_KEY`
- 持久化的 SQLite 数据目录

后端已经包含 Railway 持久化 Volume 的相关处理；生产环境中请确保数据库文件位于持久化存储，而不是临时文件系统。

---

## 🔒 安全与隐私

后端目前包含以下基础保护：

- Helmet HTTP 安全头
- CORS Origin 限制
- 登录接口频率限制
- 留言接口频率限制
- 游客与登录用户均可留言限制
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
> 楽曲やMV、関連クリエイターへのリンクをまとめ、メッセージウォールやアカウント機能も用意しています。

🌐 **サイトを見る：** https://9178osage.github.io/inabakumori-site/

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
- クリック / タップで背景を切り替え
- 雨のエフェクト
- タイトルエフェクト
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
- ゲスト / ログインユーザーの投稿の自動期限切れ

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
- Node.js built-in SQLite (`node:sqlite`)
- Helmet
- CORS
- express-rate-limit
- dotenv

---

## 📁 プロジェクト構成

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

## 🚀 ローカルで実行する

### 📋 必要な環境

- **Node.js 24.x**
- npm
- Python 3（現在のフロントエンド開発用サーバーは `python3 -m http.server` を使用）
- 利用可能な SuperTokens Core / Managed SuperTokens インスタンス

### 1. 📥 リポジトリをクローン

```bash
git clone https://github.com/9178osage/inabakumori-site.git
cd inabakumori-site
```

### 2. 📦 フロントエンド用ツール依存関係をインストール

```bash
npm install
```

### 3. 📦 バックエンド依存関係をインストール

```bash
cd backend
npm install
cd ..
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
npm run frontend
```

その後、以下にアクセスします：

```text
http://127.0.0.1:5500
```

---

## ✅ チェックとビルド

テストを実行し、認証スクリプトを再ビルド：

```bash
npm run check
```

テストのみ：

```bash
npm test
```

`js/auth.js` を再ビルド：

```bash
npm run build
```

サイト内リンクをチェック：

```bash
npm run check:links
```

厳格モード：

```bash
npm run check:links:strict
```

---

## ☁️ デプロイ

フロントエンドは静的サイトとして、たとえば **GitHub Pages** にデプロイできます。

アカウント機能とメッセージウォールは動的機能のため、別途 Node.js バックエンドをデプロイし、以下を設定する必要があります：

- `API_DOMAIN`
- `WEBSITE_URL`
- `SUPERTOKENS_CONNECTION_URI`
- `SUPERTOKENS_API_KEY`
- 永続化された SQLite ストレージ

バックエンドには Railway の永続 Volume に対応する処理が含まれています。本番環境では、データベースファイルを一時領域ではなく永続ストレージ上に配置してください。

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
