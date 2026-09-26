# 🌧️ 気象観測所 · 稲葉曇

🇨🇳 [中文](README.md) | 🇺🇸 [English](README_EN.md) | 🇯🇵 **日本語**

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
