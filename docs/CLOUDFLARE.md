# Cloudflare Pages 静态资源试点

2026-10-28：原整站 DNS 切换方案已撤回。`osagechan.top` 借用自朋友，继续使用原有 DNSPod 解析、GitHub Pages 和 TLS 设置；本轮只在当前 Cloudflare 账号部署独立的 Pages 静态资源项目。登录优化和公开留言缓存继续保留，API 仍使用 Vercel。

## 当前接入范围

手机首页画廊前 6 张缩略图可从独立 `pages.dev` 地址读取，图片加载失败时自动回到本站原路径。其余图片、桌面画廊、大图、网页和认证请求继续使用原入口。试点不需要更换 NS、操作注册商或绑定自定义域名。

2026-10-28 已通过 CLI 部署并以实际 HTTPS 响应核对资源：

| 项目 | 本轮核对结果 |
| --- | --- |
| Pages 生产地址 | <https://inabakumori-assets.pages.dev> |
| Pages 部署标识／验证日期 | `328415c5-5daa-42c4-b156-dfe12d0dcb8a`，2026-10-28 |
| 临时待激活域名区域 | 已删除；控制台返回未添加域名的账户首页 |
| DNSPod／原域名 | 未执行 NS 切换，继续原设置 |
| 本轮 Wrangler 会话 | 部署验证后已执行 `wrangler logout`，返回 `Successfully logged out` |

## 公开资源包

在仓库根目录运行：

```sh
node tools/build-asset-pilot.mjs
```

生成的上传目录是 `artifacts/cloudflare-assets-pilot/public/`，另有可交接的 `artifacts/cloudflare-assets-pilot/pilot.zip`。它们属于被 Git 忽略的本地构建产物，不进入本站 `dist/` 或文本源码副本。

打包器只导出白名单中的公开资源：6 张手机画廊缩略图、1 张手机首屏图和 Station Mono 字体，以及字体许可证、资源清单、缓存头和独立的最小提示页。本站本轮仅接入 6 张缩略图；首屏图和字体保留为资源校验样本。包中不含后端、环境变量、数据库、凭据或整站源码。

`asset-manifest.json` 记录原路径、上传路径、SHA-256 和字节数。资源文件名带内容哈希，修改字节后会生成新 URL；`/assets/*` 使用 `Cache-Control: public, max-age=31536000, immutable`。清单、提示页和 404 页面不保留长期缓存，缺失图片返回真正的 404，不回退为提示页 HTML。公开资源允许跨域读取，字体许可证一并保留。

## 部署与前端开关

使用已授权的 Wrangler 会话，将 `public/` 部署到独立 Pages 项目 `inabakumori-assets`：

```sh
wrangler pages deploy artifacts/cloudflare-assets-pilot/public --project-name=inabakumori-assets --branch=main
```

记录 CLI 返回的实际生产 URL，再以 HTTPS 核对资源清单、图片字节和缓存头；确认后才填写前端配置。部署完成并验证后执行 `wrangler logout`。本轮临时授权已退出，后续维护需重新登录。

前端使用 `APP_CONFIG.assetPilot`：

- `enabled`：是否启用手机画廊试点；设为 `false` 并按正常流程发布，即恢复全部本地缩略图。
- `origin`：已核实的独立 Pages HTTPS origin。
- `thumbnails`：6 个原始缩略图路径到已核实哈希 URL 的映射。

前端只接受同一 Pages origin 下的资源路径。远端图片出错后回退到原有本地缩略图，本页不再为该图反复尝试远端地址。原始本地文件始终保留，便于快速关闭试点。

## 每次更新时核对

重新打包后，对照清单逐一检查已上传资源的 SHA-256、字节数和响应类型；哈希文件应返回一年 `immutable` 缓存，缺失路径应为 404。只有实际响应可以证明资源已可用，不能以 ZIP 生成或 CLI 上传成功代替。

核对手机画廊前 6 张图正常读取，并验证远端失败后的本地回退；桌面画廊和大图维持原入口。清单更新后同步 `thumbnails` 映射，保留旧哈希资源供已有页面访问。按项目规定完成提交、推送、发布、线上检查和完整文本副本同步。

这是一项可关闭的小范围资源试点；是否扩展到字体、首屏图或其他资源，待实际效果和稳定性验证后再决定。域名托管、TLS 和 Vercel API 不属于本轮试点的变更范围。

本轮 8 个二进制的 SHA-256、字节数、跨域头和一年缓存头均符合清单；实际缺失资源返回 404 和 `no-store`。用同一张 1,776 字节缩略图在本机各读取三次，Cloudflare 总耗时约 102–109 ms，原站约 64–540 ms；后两次原站反而更快。这个小样本不代表用户分布、浏览器持久缓存或整页性能，没有据此宣称提速，也未扩大首屏图和字体接入。
