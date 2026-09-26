<a id="readme-zh"></a>

# 🌧️ 气象观测站 · 稲葉曇

🇨🇳 **中文** | 🇺🇸 [English](#readme-en) | 🇯🇵 [日本語](#readme-ja)

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

只是因为喜欢稲葉曇，所以做了一个“气象观测站”（致敬第二张专辑名）。

**有人看到，就已经很好了。**

☔ **稲葉曇万岁！**


---

<a id="readme-en"></a>

# 🌧️ Weather Observation Station · 稲葉曇

🇨🇳 [中文](#readme-zh) | 🇺🇸 **English** | 🇯🇵 [日本語](#readme-ja)

> An unofficial fan website created simply because I really love **稲葉曇 / Inabakumori**.  
> It collects songs, MVs, related creator links, and also includes a message wall and account features.

🌐 **Live site:** https://9178osage.github.io/inabakumori-site/

---

## 🌧️ About This Project

**Weather Observation Station** is a personal fan website dedicated to Inabakumori.

The site is built mainly with vanilla HTML, CSS, and JavaScript, without a large frontend framework. In addition to song information and related links, it includes multilingual support, theme switching, responsive layouts, an account system, and a message wall.

This project is still being actively updated. The content may not be professional or complete, but it has been carefully organized.

> This is an unofficial, non-commercial fan project and is not affiliated with Inabakumori, Nukunuku Nigirimeshi, or any official label/platform.

---

## ✨ Features

### 🎵 Song Library

- Inabakumori songs and MV links
- Album, vocalist, and other tag information
- Recorded YouTube view counts and check dates
- Fuzzy search by song title / tags
- Multi-keyword search
- Required keywords with `+keyword`
- Tag filtering
- Random song button
- Search result count

### 🌐 Languages

Currently supported:

- 中文
- English
- 日本語

The selected language is saved in the browser.

### 🌙 Interface & Visuals

- Light / dark theme switching
- Responsive desktop / mobile layout
- Separate desktop and mobile backgrounds
- Click to switch backgrounds
- Rain effects
- Title visual effects
- Saved theme and language preferences
- Web App Manifest

### 🔗 Inabakumori & NKNK Links

The site includes related links for platforms such as:

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

The account system is powered by **SuperTokens**:

- Email / password registration
- Sign in / sign out
- Session management
- Forgot password / password reset

### 💬 Message Wall

- Guest messages
- Signed-in user messages
- View your own messages
- Delete your own messages
- Pagination
- Admin message moderation
- Message length limits
- Rate limiting
- Basic spam / contact-information filtering
- Automatic expiration for guest messages

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

For local development, configure SuperTokens and use local website/API addresses. For example:

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

The frontend can be deployed as a static website, for example with **GitHub Pages**.

The account system and message wall are dynamic features, so they also require a separately hosted Node.js backend configured with:

- `API_DOMAIN`
- `WEBSITE_URL`
- `SUPERTOKENS_CONNECTION_URI`
- `SUPERTOKENS_API_KEY`
- Persistent SQLite storage

The backend already includes handling for Railway persistent Volumes. In production, make sure the database file is stored on persistent storage rather than an ephemeral filesystem.

---

## 🔒 Security & Privacy

The backend currently includes several basic protections:

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

If you find:

- Incorrect song information
- Broken links
- Bugs
- Translation issues
- A feature that would fit the project

Feel free to open an **Issue** or send a suggestion.

---

## ❤️ Finally

This website does not have a complicated goal.

I made a “Weather Observation Station” because I like Inabakumori — a tribute to the title of the second album.

**If even a few people see it, that is already enough.**

☔ **Long live Inabakumori!**


---

<a id="readme-ja"></a>

# 🌧️ 気象観測所 · 稲葉曇

🇨🇳 [中文](#readme-zh) | 🇺🇸 [English](#readme-en) | 🇯🇵 **日本語**

> **稲葉曇 / Inabakumori** が大好きだから作った、非公式のファンサイトです。  
> 楽曲、MV、関連クリエイターへのリンクをまとめ、メッセージウォールやアカウント機能も備えています。

🌐 **サイトを見る：** https://9178osage.github.io/inabakumori-site/

---

## 🌧️ このプロジェクトについて

**気象観測所** は、稲葉曇をテーマにした個人制作のファンサイトです。

フロントエンドは主に素の HTML、CSS、JavaScript で構成されており、大規模なフレームワークは使用していません。楽曲情報や関連リンクに加えて、多言語対応、テーマ切り替え、レスポンシブデザイン、アカウント機能、メッセージウォールなどを実装しています。

このプロジェクトは現在も更新中です。内容は必ずしも専門的・完全ではありませんが、一つひとつ丁寧に整理しています。

> This is an unofficial, non-commercial fan project and is not affiliated with Inabakumori, Nukunuku Nigirimeshi, or any official label/platform.

---

## ✨ 主な機能

### 🎵 楽曲ライブラリ

- 稲葉曇の楽曲と MV へのリンク
- アルバム、ボーカルなどのタグ情報
- YouTube 再生回数と確認日の記録
- 曲名 / タグのあいまい検索
- 複数キーワード検索
- `+キーワード` による必須条件指定
- タグフィルター
- ランダム楽曲
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
- PC 用 / モバイル用の背景
- クリックで背景切り替え
- 雨のエフェクト
- タイトルのビジュアルエフェクト
- テーマと言語設定の保存
- Web App Manifest

### 🔗 稲葉曇・NKNK 関連リンク

以下を含む関連リンクを掲載しています：

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

アカウント機能には **SuperTokens** を使用しています：

- メールアドレス / パスワードでの登録
- ログイン / ログアウト
- セッション管理
- パスワードを忘れた場合のリセット

### 💬 メッセージウォール

- ゲスト投稿
- ログインユーザーの投稿
- 自分の投稿一覧
- 自分の投稿の削除
- ページネーション
- 管理者による投稿管理
- 投稿文字数制限
- レート制限
- 基本的なスパム / 連絡先情報のフィルタリング
- ゲスト投稿の自動期限切れ

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

ローカル開発では、SuperTokens を正しく設定し、Web サイトと API の URL をローカル用にします。例：

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

アカウント機能とメッセージウォールは動的機能のため、別途 Node.js バックエンドを実行し、以下を設定する必要があります：

- `API_DOMAIN`
- `WEBSITE_URL`
- `SUPERTOKENS_CONNECTION_URI`
- `SUPERTOKENS_API_KEY`
- 永続化された SQLite ストレージ

バックエンドには Railway の永続 Volume に対応する処理が含まれています。本番環境では、データベースファイルを一時ファイルシステムではなく永続ストレージ上に配置してください。

---

## 🔒 セキュリティとプライバシー

バックエンドには現在、以下の基本的な保護機能があります：

- Helmet による HTTP セキュリティヘッダー
- CORS Origin 制限
- 認証エンドポイントのレート制限
- メッセージ投稿のレート制限
- ゲスト投稿制限
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

以下のような点を見つけた場合：

- 楽曲情報の誤り
- リンク切れ
- バグ
- 翻訳の修正
- 追加すると良さそうな機能

Issue を作成するか、提案を送ってください。

---

## ❤️ 最後に

このサイトに、難しい目標はありません。

稲葉曇が好きだから、「気象観測所」を作りました（2ndアルバムのタイトルへのオマージュです）。

**誰か一人でも見てくれたら、それだけで十分です。**

☔ **稲葉曇万歳！**

