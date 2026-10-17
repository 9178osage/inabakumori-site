# 待办与已知问题（AI 交接用）

整理日期：2026-10-17　基线提交：`3c93ee3`（已在 `main` 并发布）

本文只写**还没做的**和**别再踩的坑**；已完成的部分见 `git log` 与 [CHANGELOG.md](CHANGELOG.md)，项目概况见 [AI_HANDOFF.md](AI_HANDOFF.md)。接手时先确认维护者的下一项需求，不要把本文当成功能清单。

## 当前基线（可直接复核）

| 项 | 值 |
| --- | --- |
| HEAD | `3c93ee3` |
| `npm test` | 245 / 245 通过 |
| `npm run check` | 退出码 0（测试 + 后端语法 + 构建 + 产物校验） |
| `Verify website` | success，运行 `39002239202` |
| `Publish public site` | success，运行 `39002239184` |
| `/healthz` | `{"ok":true,"version":"3c93ee3"}` |
| 线上产物 | `js/comments.js` 与本地 `dist/` 构建 sha256 一致 |

```sh
curl -s https://inabakumori-site-production.up.railway.app/healthz
curl -s "https://api.github.com/repos/9178osage/inabakumori-site/actions/runs?per_page=12" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const r of JSON.parse(s).workflow_runs.filter(x=>x.head_sha.startsWith("3c93ee3")))console.log(r.name,r.status,r.conclusion)})'
curl -s https://osagechan.top/js/comments.js | shasum -a 256   # 与 dist/js/comments.js 对比
```

## 待办（按优先级）

### 1. 扫一遍「断言之前就抛错」的测试（建议优先）

`tools/tests/comment-focus.test.cjs` 曾有两条用例在断言前抛 `ReferenceError`（`const` 的 TDZ：轮询条件读了下一行才声明的 `list`）。表现极具误导性：失败只用 1–3ms、错误信息不是 `AssertionError`、调试输出（`console.error`）也永远不会出现——因为它同样在抛出点之后。

```sh
node --test tools/tests/*.test.cjs 2>&1 | grep -nE "ReferenceError|TypeError|SyntaxError"
```

若接入 lint，`no-use-before-define`（含 `variables: true`）能挡住同类问题。

### 2. 把上线记录表的校验脚本化

现在靠人工核对，而且已经翻过一次车。建议加 `tools/check-changelog-table.mjs`，规则：无重复提交行、无重复运行号、每个号属于该提交、按运行时刻新→旧、日期等于该运行的太平洋日期。

**必须注意**：拉取运行列表失败（网络、限流）时要以非零码退出。我在限流时让脚本 `continue`，结果 35 行全部跳过却仍打印「全表通过」，是假绿。

CI 里可直接用 `${{ secrets.GITHUB_TOKEN }}` 调 API（未认证只有 60 次/小时，本轮就被它卡住过一次）；`check.yml` 现有的 `permissions: contents: read` 足够读取。

### 3. `loadMoreFocus` 的剩余边界需要产品判断

`js/comments.js` 现在记录点击时已在屏的行集合（`const known = new Set([...list.children])`），只把之后出现的行当作「新留言」。两个未定边角：

- **行元素被复用**：请求期间某行被删、随后又加回同一元素，它在集合里 → 不算新行 → 焦点回退到列表。是否符合预期？
- **整表重建**：若列表元素被整体替换，所有行都算「新」，会聚焦第一行。需要确认这是期望行为。

### 4. 更早的上线记录行未逐一与 API 对账

我用运行列表索引了约 151 个提交，能覆盖的行都已核对；表格里 10-12 及部分 10-13 的行因运行太早未被索引，未单独验证。

### 5. （可选）「晚一行」规则自动化

表里已写明：写这张表的提交要等下一次推送才有运行记录，所以总比表格晚一行。若想自动化，可加定时工作流读取最新 push 的运行并追加行——但写表提交自身仍会晚一行，无法真正消除。

## 禁止与约束（务必遵守）

- **`inabakumori-site-all-code/` 是维护者自行维护的本地文本副本**（已在 `.gitignore`）。**任何 AI 不得读写、生成或校验其中任何文件**；需要更新副本时由维护者自己运行工具。维护者已明确要求其他 AI 同样不得改动。
- **不要用 `.`、`./` 或 `**` 作为搜索根**——会遍历到上述副本。检索一律限定显式路径（`js/`、`tools/`、`docs/`、`backend/`）。我本轮曾两次用 `.` 递归 `grep` 路过副本（只读、无命中输出），已被维护者叫停。
- 每次改动后：`npm test` + `npm run check`；然后提交、推送，并核对**两条**工作流与 `/healthz`。不要只保存在本地。
- `docs/CHANGELOG.md` 只记**访客可感知**的变化；测试、内部重构、依赖升级不进 CHANGELOG（见该文件开头）。
- **报告纪律**：说「通过」之前，先确认检测器真的执行了。
- 不要伪造数据（播放量、邮件发送、部署结果）；拿不到就说拿不到。

## 本轮踩过的两个坑（供参考）

1. **「调试输出看不到」不等于「没执行」**：`ReferenceError` 抛在 `console.error` 之前，日志自然空白。先看错误类型与耗时，再下结论。
2. **「全表通过」可能是空转**：校验脚本吞掉「索引为空」的情况时，会把跳过当成通过。给脚本加「零覆盖即失败」的断言。
