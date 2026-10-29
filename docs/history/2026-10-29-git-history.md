# 原图历史清理复查：2026-10-29

不能把普通分支清理完成等同于全部远端对象已清除。

## 已完成的分支清理

2026-10-28 已重写并强推普通分支，移除 `NKNK/` 原图；原图保存在仓库外，生成后的 WebP 继续受版本控制并正常发布。

2026-10-29 从 GitHub 新建完整镜像复查，5 个普通远端分支的全部祖先均不含 `NKNK/`：`main`、`gh-pages`、`codex/updates-in-home`、`codex/x-posts-archive`、`refactor/deps-2026-10-21`。当前普通本地对象包约 41.25 MiB。

历史中仍保留生成器使用的背景源图 `images/hero/` 与 `images/hero-mobile/`；最大单个文件为 `images/hero-mobile/005.png`（1,065,645 字节）。这些不是已迁出的 NKNK 原图。

## GitHub 仍保留的 PR 引用

完整镜像额外包含以下旧引用，仍可达清理前的 NKNK 原图，使本次完整镜像对象包约为 130.91 MiB：

| GitHub 引用 | PR 状态 | 清理前提交 |
| --- | --- | --- |
| `refs/pull/1/head` | 已合并 | `90f2c6905063568a95ef6288bdafa17787c95032` |
| `refs/pull/2/head` | 已合并 | `c22679e8c200aba79a8c5b8181eea24496bc19b3` |
| `refs/pull/3/head` | 已关闭，未合并 | `e3d9b80ee338daaaae41c0645155528ac651e823` |

GitHub 将 `refs/pull/` 标为只读，普通 Git 强推不能覆盖或删除这些引用。[官方说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)同时指出其敏感数据移除流程不处理普通非敏感数据，不能承诺通过该流程移除这些图片。

本轮没有删除、重建或迁移仓库，也没有更改 PR 状态。此类操作会影响现有 PR、仓库配置与发布，不能作为普通历史强推的替代步骤自动执行。若要求这些 PR 引用也不再存在，需要另行决定仓库迁移方案。

原图恢复备份仍保留。公开核验结果保存于被忽略的 `artifacts/verifications/history-audit-20261029.json`，不作为网站资源部署。
