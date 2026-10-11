# 后端安全与运维

## 2026-10-11 第三轮补丁

- 认证 SDK 的非 JSON 备用解析器能绕过 Express 的 20 KB 请求体限制。本轮在所有解析器之前要求带 body 的请求使用 `application/json`；非 JSON/缺类型返回 415，JSON（含 gzip 与 chunked）仍受解压后 20 KB 上限。无 body 的会话操作继续有效。
- Header auth 的前端令牌实际存于 JavaScript Cookie。本轮采用独立 `__Host-station-` 名称，强制 `Secure`、`Path=/`、无 Domain；清理并忽略旧 Cookie，不复制旧令牌。新 bundle 发布后需关闭旧标签页，重新打开 HTTPS 页面并登录一次。
- 完整测试、构建与隔离 HTTP 集成验证通过；联网依赖审计均为 0 个已知漏洞。复现与写操作只在本机隔离环境执行。
- 代码补丁尚未发布。细节与限制见根目录 `SECURITY_NOTES.md`，现网版本/DNS/CI/分支保护证据见 `docs/SECURITY_DEPLOYMENT_REVIEW_2026-10-11.md`。

## 2026-10-10 加固

- 2026-10-11 起管理员只通过 Railway `ADMIN_USER_IDS`（SuperTokens 稳定 user ID，多个值用逗号分隔）授权；`ADMIN_EMAILS` 已移除，设置了也只会在启动日志里提示“已不再使用”。`ADMIN_USER_IDS` 为空时启动日志会警告。不要根据陌生人提供的邮箱或 ID 直接授予权限。
- `/healthz` 只公开 `{ ok, version }`。
- 可选备份接口 `GET /api/admin/backup`：需 Railway `BACKUP_TOKEN`（≥32 字符），以 `Authorization: Bearer` 调用；未设置时返回 404。详见 `SECURITY_NOTES.md`。完整审查与 DNS/GitHub 清单见根目录 `SECURITY_NOTES.md`。
- 新增每 IP 每分钟 180 次总请求限制，在 JSON 解析前执行，覆盖无效 JSON 和未知路径。登录、留言及删除操作仍有更严格的独立限制。
- DELETE 限流匹配忽略路径大小写，与 Express 路由行为一致。

## 已有防护

- SuperTokens 验证登录会话；用户只能删除自己的会员留言，管理员接口另外检查权限。
- SQLite 使用参数化语句；留言类型、长度、控制字符与内容在服务器校验；前端以文本显示留言。
- JSON 请求体上限 20 KB，配置请求超时，生产错误不返回内部堆栈。
- 新域名 `https://osagechan.top` 已配置为 Railway 的 `WEBSITE_URL`。CORS 不是身份验证，客户端能伪造 Origin；保护操作仍必须通过会话及权限检查。
- 密码重置链接将令牌放在 URL fragment，前端读取后清除地址中的令牌。

## 验证与边界

运行 `npm run check` 和 `npm run test:integration`。集成检查使用临时数据库和本机服务，不在生产留言墙发布测试内容。依赖可通过 `npm --prefix backend audit --omit=dev` 检查。

限流状态保存在单个进程内，重启会重置，不抵御分布式 DDoS。SQLite 与当前限流实现按单实例部署；扩容需要共享限流存储及数据库方案。持续监控 Railway 的错误、请求量、资源使用和费用，并保持数据库备份。管理员真实登录及邮件投递需要账号持有人参与验证。
