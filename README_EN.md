# Weather Observation Station · 稲葉曇

[中文](README.md) | **English**

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

### Frontend

- HTML5
- CSS3
- Vanilla JavaScript
- SuperTokens Web JS
- esbuild

### Backend

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

### Requirements

- **Node.js 24.x**
- npm
- Python 3 (the current frontend dev server uses `python3 -m http.server`)
- A working SuperTokens Core / Managed SuperTokens instance

### 1. Clone the repository

```bash
git clone https://github.com/9178osage/inabakumori-site.git
cd inabakumori-site
```

### 2. Install frontend tooling dependencies

```bash
npm install
```

### 3. Install backend dependencies

```bash
cd backend
npm install
cd ..
```

### 4. Configure backend environment variables

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

### 5. Start the backend

From the repository root:

```bash
npm run backend
```

Default API address:

```text
http://127.0.0.1:3001
```

### 6. Start the frontend

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

I made it because I like Inabakumori and wanted to build a weather observation station of my own.

**If even a few people see it, that is already enough.**

**Long live Inabakumori!**
