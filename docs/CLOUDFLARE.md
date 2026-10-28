# Cloudflare 接入准备

2026-10-28：尚未切换 DNS，当前仍由 DNSPod 解析、GitHub Pages 直连提供网页。下文是已核对的接入方案，不代表 Cloudflare 已启用；完成控制台配置和线上验证后再更新本节状态。

## 切换前的已知记录

公开权威 DNS 检查得到：

| 名称／类型 | 当前值 |
| --- | --- |
| NS | `leaf.dnspod.net`、`slick.dnspod.net` |
| 根域 A | `185.199.108.153`、`185.199.109.153` |
| 根域 AAAA | `2606:50c0:8000::153`、`2606:50c0:8001::153` |
| 根域 CAA | `0 issue "letsencrypt.org"` |
| GitHub 验证 TXT | `_github-pages-challenge-9178osage.osagechan.top`，原值须从 DNSPod 完整保留 |

注册商为 DNSPod／腾讯；当时未发现 DS 或 DNSKEY，注册局 RDAP 也显示未签名。根域未发现 MX／TXT，`www`、`mail` 无解析。这不是完整区域导出，切换前必须从 DNSPod 控制台导出所有记录，逐条核对 Cloudflare 自动扫描，尤其是 GitHub 验证 TXT 和其他未公开列举的子域。保留原 NS 和导出文件用于回退。

## 免费接入和缓存规则

在 Cloudflare 添加现有域名并选 Free，先以 DNS-only 导入和核对记录，再将注册商 NS 改为 Cloudflare 实际分配的两条 NS。网页源站继续使用现有 GitHub Pages，API 继续使用现有 Vercel 域名。

TLS 使用 Full (strict)。只有 Cloudflare Universal 证书状态 Active、源站证书有效且主机名匹配时，才开启根域 A／AAAA 的代理。保留 Let’s Encrypt 的 CAA；如果边缘证书因 CAA 等待签发，按实际 CA 和控制台诊断处理。官方说明 Cloudflare DNS 会为支持的 CA 添加所需 CAA，不能凭猜测删除源站授权。[严格 TLS](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)、[CA 与 CAA](https://developers.cloudflare.com/ssl/reference/certificate-authorities/)

只为优化后的 WebP 图片和 WOFF2 字体延长边缘缓存。浏览器保持源站当前的 600 秒，避免固定文件名被浏览器保留数天。Free 支持 Cache Response Rules；创建一条 `set_cache_control` 规则，匹配表达式为：

```text
http.host eq "osagechan.top"
and http.request.method in {"GET" "HEAD"}
and http.response.code eq 200
and (
  (starts_with(http.request.uri.path, "/images/optimized/") and ends_with(http.request.uri.path, ".webp"))
  or (starts_with(http.request.uri.path, "/fonts/") and ends_with(http.request.uri.path, ".woff2"))
)
```

操作参数：

```json
{
  "s-maxage": {
    "operation": "set",
    "value": 2592000,
    "cloudflare_only": true
  }
}
```

这只把成功响应在 Cloudflare 的有效期设为 30 天；不修改浏览器指令、不剥离 ETag、Last-Modified 或 Set-Cookie，保留包含查询串的默认缓存键。全局 Browser Cache TTL 选择 Respect Existing Headers。HTML、脚本、登录和留言 API 不匹配此规则；错误响应不获得长缓存。[响应规则](https://developers.cloudflare.com/cache/how-to/cache-response-rules/)、[规则字段与参数](https://developers.cloudflare.com/cache/how-to/cache-response-rules/settings/)

## 发布核对与回退

启用后核对权威 NS、HTTPS、`cf-ray` 和资源字节；对同一图片、字体重复 GET，观察 `cf-cache-status: HIT`／Age。Cloudflare 不保证每次都命中或保留至完整 TTL，不能把配置成功当成实际命中。另查首页没有获得 30 天缓存，Vercel `/healthz` 和留言接口仍正常。

以后替换固定路径的图片／字体，须更新引用 URL 的 `v` 版本并重新发布，或在发布时清除 Cloudflare 对应 URL 的边缘缓存并计入浏览器的 600 秒等待；默认缓存键保留查询串，不开启 Ignore Query String。[缓存键](https://developers.cloudflare.com/cache/how-to/cache-keys/)

若代理异常，先关闭根域代理恢复源站直连；若需撤回 DNS 托管，在注册商恢复原 DNSPod NS。切换与回退都要保留完整记录并等待实际 DNS 生效。以后若启用 DNSSEC，再迁移必须先按服务商流程处理 DS，不能照搬当前未签名状态。[完整区域切换说明](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
