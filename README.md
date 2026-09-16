# 气象观测站

## 文件放在哪里

| 位置 | 用途 |
| --- | --- |
| `index.html` | 首页内容和页面结构 |
| `js/songs.js` | 歌曲列表：歌名、链接、分类、虚拟歌姬 |
| `script.js` | 搜索、TAG、语言切换、背景与页面交互 |
| `js/i18n.js` | 中文、英文、日文文案 |
| `js/mobile-backgrounds.js` | 手机背景图设置 |
| `js/comments-management.js` | 留言管理界面 |
| `js/config.js` | 前端连接后端的配置 |
| `style.css` | 页面外观与手机适配 |
| `images/` | 图片；手机背景在 `images/hero-mobile/` |
| `fonts/` | 字体文件与授权 |
| `src/auth-src.js` | 登录界面的源代码 |
| `js/auth.js` | 登录源代码构建生成的文件 |
| `backend/` | 后端、私密配置和本地留言数据库 |
| `tests/` | 自动检查 |

`node_modules/` 是安装依赖时自动生成的目录，不需要手动整理，也不上传 GitHub。

## 在 Mac 上启动

在一个终端窗口启动前端：

```sh
cd ~/Desktop/inabakumori-site
python3 -m http.server 5500 --bind 127.0.0.1
```

打开 http://127.0.0.1:5500/ 。如果已经通过 Live Server 启动前端，就使用现有服务。

在另一个终端窗口启动后端：

```sh
cd ~/Desktop/inabakumori-site/backend
node server.mjs
```

后端沿用已有的 `.env` 配置，终端窗口需要保持打开。

## 修改后检查

在项目根目录运行：

```sh
npm test
```

修改 `src/auth-src.js` 后，运行以下命令更新 `js/auth.js`：

```sh
npm run build
```

`.env` 和留言数据库属于本地私密文件，继续由 `.gitignore` 排除。
