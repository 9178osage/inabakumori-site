#!/usr/bin/env python3
"""稻网（inabakumori-site）源码文本副本。副本 = git HEAD 的逐字节拷贝，不做任何替换。

规则（用户 2026-10-20 将代码上限恢复为 130,000 字节，帖子正文单独归档）：
  1. 每段以 `===== 文件路径 =====` 开头，内容与 `git show HEAD:<路径>` 逐字节相同。
  2. 代码和说明每个 txt 不超过 CAP 字节，差异每卷不超过 CHANGES_CAP 字节。源文件与单文件补丁不切开。差异保留一行上下文，只列出最多 10 个变化的帖子分片名，其余计数。
  3. 四组互不重叠：1-app-code / 2-tools-tests / 3-docs / 4-x-posts；帖子正文上限为 X_POSTS_CAP。
  4. txt 文件数量按完整源文件体积自动调整，包含使用说明和差异附件。
  5. 只读 git 跟踪的文件，排除 js/auth.js（源码是 tools/auth-src.js）、两个 package-lock.json、
     二进制文件，以及 dist/、.env*、数据库、密钥和本地私有文件。
  6. 输出文件夹已被 .gitignore 忽略，永不提交、不上线；生成器在 tools/ 中受版本控制。

用法
  python3 tools/sync-copy.py [<base>]         生成副本和差异卷（<base>..HEAD，默认读 .review-base）
  python3 tools/sync-copy.py --check          只核对，不写任何文件；差异起点未覆盖 .review-base 时只提示缺口
  python3 tools/sync-copy.py --mark-reviewed  把 HEAD 记为新的 .review-base
"""
import codecs, json, os, re, stat, subprocess, sys, tempfile
from typing import NamedTuple

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "inabakumori-site-all-code")
CAP = 130_000
CHANGES_CAP = 250_000
SHARD_NOTE_NAMES = 10
X_POSTS_CAP = 140_000_000  # 第 4 组数据单独打包，按十进制字节计。
GUIDE = "0-使用说明.txt"
GUIDE_TITLE = "稻网源码文本副本 · 使用说明"
GUIDE_INDEX_HEADING = "六、源码文件所在分卷\n\n"
EXCLUDE = {"js/auth.js", "package-lock.json", "backend/package-lock.json"}
BINARY = re.compile(r"\.(png|jpe?g|webp|gif|ico|avif|bmp|tiff?|svgz|eot|woff2?|ttf|otf|mp[34]|ogg|m4a|wav|flac|webm|mov|zip|gz|7z|pdf|dmp|ai|db|sqlite3?)(?:-(?:wal|shm|journal))?$", re.I)
PRIVATE = re.compile(r"(?:^|[/_.-])(?:secrets?|credentials?|private[-_]?key|id_rsa|id_ed25519)(?:$|[/_.-])|\.(?:pem|key|p12|pfx|jks|keystore|sql|dump|bak)$", re.I)
SOURCE_VOLUME = re.compile(r"(?:1-app-code|2-tools-tests|3-docs|4-x-posts)-\d+\.txt")
CHANGE_PART = re.compile(r"changes-([1-9][0-9]{0,11})\.txt")
CHANGE_HEADER = re.compile(r"# changes \S+\.\.[0-9a-f]{4,64}（仅含符合导出规则的文本文件）\n".encode())
PART_HEADER = re.compile(rb"# sync-copy changes v1 part ([0-9]{1,12})/([0-9]{1,12}) ([0-9a-f]{40}(?:[0-9a-f]{24})?)\.\.([0-9a-f]{40}(?:[0-9a-f]{24})?)\n")
GUIDE_RANGE = re.compile(r"^差异范围：(\S+)\.\.[0-9a-f]+(?:（|；)", re.M)
FULL_SHA = r"[0-9a-f]{40}(?:[0-9a-f]{24})?"
GUIDE_COVERAGE = re.compile(rf"差异范围：(\S+)\.\.([0-9a-f]{{4,64}})（实际提交：({FULL_SHA})\.\.({FULL_SHA})）")
GUIDE_PART_LIST = re.compile(r"差异附件（([1-9][0-9]{0,11}) 份，按顺序）：(.+)")
PATCH_START = re.compile(rb"^diff --git ", re.M)
X_POSTS_FILE = re.compile(r"^data/x-posts/posts-[^/]+\.json$")
APP_ROOT = {"index.html", "updates.html", "404.html", "calendar.html", "style.css", "updates.css", "archive.css", "calendar.css", "script.js", "site.webmanifest", "robots.txt",
            "sitemap.xml", "package.json", "CNAME", ".nojekyll", "tools/auth-src.js"}
TOOL_ROOT = {".gitignore", ".npmrc", "eslint.config.mjs"}
DOC_ROOT = {"AGENTS.md", "LICENSE", "NOTICE.md", "README.md", "SECURITY.md"}
APP_DIRS = ("js/", "backend/", "fonts/", "images/", "data/", "网站海报/")
DIFF_PATH_BYTES = 24_000  # 给命令、环境和系统的参数指针保留充足空间。
LAUNCHER = b'''#!/usr/bin/env python3
"""Compatibility entry point; export rules live in tracked tools/sync-copy.py."""
import os
import runpy
import stat

here = os.path.dirname(os.path.realpath(__file__))
for root in (here, os.path.dirname(here)):
    tools = os.path.join(root, "tools")
    target = os.path.join(tools, "sync-copy.py")
    try:
        tools_mode = os.lstat(tools).st_mode
    except FileNotFoundError:
        continue
    if stat.S_ISLNK(tools_mode):
        raise SystemExit("Refusing symlink in tools/sync-copy.py path")
    if not stat.S_ISDIR(tools_mode):
        raise SystemExit(f"Expected a directory at {tools}")
    try:
        target_mode = os.lstat(target).st_mode
    except FileNotFoundError:
        continue
    if stat.S_ISLNK(target_mode):
        raise SystemExit("Refusing symlink in tools/sync-copy.py path")
    if not stat.S_ISREG(target_mode):
        raise SystemExit(f"Expected a regular file at {target}")
    runpy.run_path(target, run_name="__main__")
    break
else:
    raise SystemExit("Cannot locate tools/sync-copy.py beside this launcher or in its parent directory")
'''


def output_directory(create=False):
    try:
        info = os.lstat(OUT)
    except FileNotFoundError:
        if not create:
            sys.exit("副本目录不存在，请先运行同步")
        os.mkdir(OUT, 0o700)
        info = os.lstat(OUT)
    if not stat.S_ISDIR(info.st_mode):
        sys.exit("副本输出目录必须是真实目录，不得使用符号链接")
    if stat.S_IMODE(info.st_mode) != 0o700:
        if not create:
            sys.exit("副本目录权限必须为 0700，请先运行同步以收紧权限")
        descriptor = os.open(OUT, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
        try:
            if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
                sys.exit("副本输出目录必须是真实目录")
            os.fchmod(descriptor, 0o700)
        finally:
            os.close(descriptor)


def output_file(name):
    if os.path.basename(name) != name or name in {".", ".."}:
        sys.exit("无效的副本输出文件名")
    target = os.path.join(OUT, name)
    try:
        info = os.lstat(target)
    except FileNotFoundError:
        return target
    if not stat.S_ISREG(info.st_mode):
        sys.exit(f"副本输出必须是普通文件，不得使用符号链接: {name}")
    return target


def write_output(name, data):
    output_directory()
    target = output_file(name)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{name}.", suffix=".tmp", dir=OUT)
    try:
        with os.fdopen(descriptor, "wb") as result:
            result.write(data)
        output_directory()
        output_file(name)
        os.replace(temporary, target)
    finally:
        if os.path.lexists(temporary):
            os.remove(temporary)


def group(p):
    if p not in APP_ROOT | TOOL_ROOT | DOC_ROOT and not p.startswith(APP_DIRS + ("tools/", ".github/", "docs/")):
        sys.exit(f"未识别的源码分组: {p}；请先为新路径明确配置导出分组")
    if X_POSTS_FILE.fullmatch(p):
        return "4-x-posts"
    if p in DOC_ROOT or p.endswith(".md") or p.startswith("docs/"):
        return "3-docs"
    if p in APP_ROOT or p.startswith(APP_DIRS):
        return "1-app-code"
    return "2-tools-tests"  # tools/、.github/ 及显式列出的根目录配置。


def limit(name):
    if name == "changes.txt" or CHANGE_PART.fullmatch(name):
        return CHANGES_CAP
    return X_POSTS_CAP if name == "4-x-posts" or name.startswith("4-x-posts-") else CAP


def volume_order(name):
    match = re.fullmatch(r"(.+)-(\d+)\.txt", name)
    return (match.group(1), int(match.group(2)), name) if match else (name, 0, name)


def git_environment():
    # 路径匹配由调用点决定，不能被终端继承的 pathspec 开关改写。
    return dict(os.environ, GIT_LITERAL_PATHSPECS="0", GIT_GLOB_PATHSPECS="0",
                GIT_NOGLOB_PATHSPECS="0", GIT_ICASE_PATHSPECS="0")


def git_result(*args):
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, env=git_environment())


def git(*args):
    r = git_result(*args)
    if r.returncode:
        sys.exit(f"git {' '.join(args)} 失败: {r.stderr.decode('utf-8', 'replace')[:200]}")
    return r.stdout


def allowed(p):
    parts = p.split("/")
    return not (
        p in EXCLUDE or BINARY.search(p) or PRIVATE.search(p)
        or any(s.lower() in {"dist", "node_modules", ".git", ".local-notes", ".backups", "inabakumori-site-all-code"}
               or s.lower().startswith(".env") for s in parts)
        or parts[-1].startswith("SECURITY_AUDIT_")
    )


def is_text(data):
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return not any(b < 32 and b not in (9, 10, 13) for b in data)


def files(head="HEAD"):
    out = []
    for entry in git("ls-tree", "-r", "-z", head).split(b"\0"):
        if not entry:
            continue
        metadata, path = entry.split(b"\t", 1)
        p = path.decode("utf-8")
        if not allowed(p):
            continue
        # core.symlinks=false 会把已提交的符号链接检出为普通文本文件。
        if metadata.startswith(b"120000 "):
            sys.exit(f"{p} 源码路径不得使用符号链接")
        data = git("show", f"{head}:{p}")
        if not is_text(data):
            continue
        # 副本基于已提交版本，但必须同时与磁盘上的实际源码一致。
        try:
            source_path = REPO
            for part in p.split("/"):
                source_path = os.path.join(source_path, part)
                info = os.lstat(source_path)
                if stat.S_ISLNK(info.st_mode):
                    sys.exit(f"{p} 源码路径不得使用符号链接")
            if not stat.S_ISREG(info.st_mode):
                sys.exit(f"{p} 必须是普通源码文件")
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
            descriptor = os.open(source_path, flags)
            with os.fdopen(descriptor, "rb") as source:
                if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                    sys.exit(f"{p} 必须是普通源码文件")
                current = source.read()
        except OSError:
            sys.exit(f"{p} 缺失或不可读；请先恢复或提交源码，再刷新副本")
        if current != data:
            sys.exit(f"{p} 有未提交改动；请先按项目约定提交，再刷新副本")
        out.append((p, data))
    return out


def section(p, data):
    # 两个换行始终属于分隔框架，原始文件字节（包括是否有末尾换行）保持原样。
    return f"===== {p} =====\n".encode() + data + b"\n\n"


def build(head):
    vols, index = {}, {}
    for p, data in files(head):
        g = group(p)
        piece = section(p, data)
        cap = limit(g)
        if len(piece) > cap:
            sys.exit(f"{p} 单个文件就超过 {cap:,} 字节，无法放进副本")
        parts = vols.setdefault(g, [[]])
        if sum(map(len, parts[-1])) + len(piece) > cap:
            parts.append([])
        parts[-1].append(piece)
        index[p] = f"{g}-{len(parts)}.txt"
    result = {}
    for g in sorted(vols):
        for i, chunk in enumerate(vols[g], 1):
            result[f"{g}-{i}.txt"] = b"".join(chunk)
    return result, index


def read_review_base():
    path = output_file(".review-base")
    try:
        with open(path, encoding="utf-8") as source:
            return source.read().strip()
    except FileNotFoundError:
        return None
    except UnicodeDecodeError:
        return ""  # 损坏的基线与空基线都无效，不回退到其他提交。
    except OSError:
        sys.exit("无法读取 .review-base，请检查文件权限")


def resolve_base(base):
    if not base or base.startswith("-") or "\0" in base or any(character.isspace() for character in base):
        return None
    r = git_result("rev-parse", "--verify", "--quiet", "--end-of-options", f"{base}^{{commit}}")
    return r.stdout.decode().strip() if r.returncode == 0 else None


def validate_base(base, message="无效的复核基线"):
    resolved = resolve_base(base)
    if not resolved:
        sys.exit(message)
    return resolved


def text_blobs(object_ids):
    """用一个 cat-file 进程逐个检查对象，内存不随大文件或文件总数膨胀。"""
    accepted = set()
    if not object_ids:
        return accepted
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(["git", "cat-file", "--batch"], cwd=REPO,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors,
                                   env=git_environment())
        try:
            for object_id in sorted(object_ids):
                process.stdin.write(object_id + b"\n")
                process.stdin.flush()
                header = process.stdout.readline().split()
                if len(header) != 3 or header[0] != object_id or header[1] != b"blob":
                    sys.exit("git cat-file 返回了无效的源码对象")
                remaining = int(header[2])
                decoder = codecs.getincrementaldecoder("utf-8")()
                valid = True
                while remaining:
                    chunk = process.stdout.read(min(remaining, 65_536))
                    if not chunk:
                        sys.exit("git cat-file 返回了不完整的源码对象")
                    remaining -= len(chunk)
                    if valid:
                        try:
                            decoder.decode(chunk)
                        except UnicodeDecodeError:
                            valid = False
                        if any(b < 32 and b not in (9, 10, 13) for b in chunk):
                            valid = False
                if process.stdout.read(1) != b"\n":
                    sys.exit("git cat-file 返回了无效的对象分隔符")
                if valid:
                    try:
                        decoder.decode(b"", final=True)
                    except UnicodeDecodeError:
                        valid = False
                if valid:
                    accepted.add(object_id)
            process.stdin.close()
            if process.wait():
                errors.seek(0)
                sys.exit(f"git cat-file 失败: {errors.read(200).decode('utf-8', 'replace')}")
        finally:
            process.stdin.close()
            process.stdout.close()
            if process.poll() is None:
                process.kill()
                process.wait()
    return accepted


def path_batches(paths):
    batch, size = [], 0
    for p in paths:
        # 计入每个参数的 NUL 和指针；不能只限制路径数量。
        cost = len(os.fsencode(p)) + 1 + 8
        if batch and size + cost > DIFF_PATH_BYTES:
            yield batch
            batch, size = [], 0
        batch.append(p)
        size += cost
    if batch:
        yield batch


def exact_pathspec(p):
    # literal pathspec 会把历史文件名同时当作目录前缀，重新带入已过滤的后代。
    # glob 模式中转义全部元字符，并转义首字符以强制完整 wildmatch，避免目录前缀快路。
    escaped = "".join("\\" + c if i == 0 or c in "\\*?[" else c for i, c in enumerate(p))
    return ":(top,glob)" + escaped


class ChangeSet(NamedTuple):
    base: str
    start: str
    end: str
    head_label: str
    notes: bytes
    patch: bytes
    paths: list

    def header(self):
        return f"# changes {self.base}..{self.head_label}（仅含符合导出规则的文本文件）\n".encode()


def collect_changes(base, head, short_head=False):
    start = validate_base(base)
    end = validate_base(head, "无效的差异终点")
    span = f"{start}..{end}"
    candidates, shards, object_ids = [], [], set()
    raw = git("diff", "--raw", "--no-ext-diff", "--no-textconv", "--no-color", "--no-abbrev", "--no-renames", "-z", span).split(b"\0")
    for offset in range(0, len(raw) - 1, 2):
        metadata, path = raw[offset:offset + 2]
        p = path.decode("utf-8")
        if not allowed(p):
            continue
        fields = metadata.split()
        # 两端都须是普通文件或不存在，不导出符号链接目标和子模块记录。
        if fields[0][1:] in (b"120000", b"160000") or fields[1] in (b"120000", b"160000"):
            continue
        # 帖子正文分片属于第 4 组数据，不进入改动复核；只列出变化的分片名。
        if X_POSTS_FILE.fullmatch(p):
            shards.append(p)
            continue
        ids = {value for value in fields[2:4] if value.strip(b"0")}
        candidates.append((p, ids))
        object_ids.update(ids)
    accepted = text_blobs(object_ids)
    paths = []
    for p, ids in candidates:
        if ids <= accepted:
            group(p)  # 删除的未知目录也不能静默归入工具组。
            paths.append(p)
    diff = b"".join(git("diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--unified=1",
                        span, "--", *batch) for batch in path_batches(exact_pathspec(p) for p in paths))
    head_label = git("rev-parse", "--short", end).decode().strip() if short_head else end
    # 分片名单最多列 SHARD_NOTE_NAMES 个，其余只计数，保证说明行本身不会挤占 changes.txt 的上限。
    listed = sorted(shards)[:SHARD_NOTE_NAMES]
    note = "".join(f"# 帖子正文分片有变化（未列入差异，见第 4 组）: {p}\n" for p in listed)
    if len(shards) > len(listed):
        note += f"# 另有 {len(shards) - len(listed)} 个帖子正文分片有变化（未逐一列出）\n"
    return ChangeSet(base, start, end, head_label, note.encode(), diff, paths)


def changes(base, head="HEAD"):
    change = collect_changes(base, head, short_head=head == "HEAD")
    return change.header() + change.notes + change.patch


def change_volumes(change):
    header = change.header()
    if len(header) + len(change.notes) + len(change.patch) <= CHANGES_CAP:
        return {"changes.txt": header + change.notes + change.patch}, []

    # Git 文件补丁头位于行首。正文行都有差异前缀，不会被误当作边界。
    starts = [match.start() for match in PATCH_START.finditer(change.patch)]
    if len(starts) != len(change.paths) or starts and starts[0] != 0:
        sys.exit("git diff 的文件补丁边界与已核对路径不一致，未写入")
    bounds = starts + [len(change.patch)]
    def part_header(part, total):
        return header + f"# sync-copy changes v1 part {part}/{total} {change.start}..{change.end}\n".encode()

    # 按最多一卷一个补丁及一卷摘要预留卷头空间。实际序号直接写出。
    max_parts = len(starts) + 1
    cap = CHANGES_CAP - len(part_header(max_parts, max_parts))
    oversized = [(path, stop - start) for path, start, stop in zip(change.paths, bounds, bounds[1:]) if stop - start > cap]
    if len(change.notes) > cap:
        oversized.append(("帖子分片变动摘要", len(change.notes)))
    if oversized:
        return {}, oversized
    parts = [bytearray(change.notes)]
    for start, stop in zip(bounds, bounds[1:]):
        if len(parts[-1]) + stop - start > cap:
            parts.append(bytearray())
        parts[-1].extend(change.patch[start:stop])
    return {f"changes-{i}.txt": part_header(i, len(parts)) + part for i, part in enumerate(parts, 1)}, []


def oversized_message(oversized):
    files = "\n".join(f"  {json.dumps(path, ensure_ascii=False)}  {size:,} 字节" for path, size in oversized)
    return f"差异待处理：以下完整补丁或摘要连同卷头无法放入 {CHANGES_CAP:,} 字节的分卷。\n{files}"


def guide(change, names, index, diffs, oversized, gap):
    ordered = sorted(names, key=volume_order)
    volumes = "\n".join("  " + n for n in ordered if n.startswith(("1-app-code-", "2-tools-tests-", "3-docs-")))
    posts = "\n".join("  " + n for n in ordered if n.startswith("4-x-posts-")) or "  （本次没有帖子正文分卷）"
    batches = "、".join(sorted(diffs, key=volume_order))
    coverage = oversized_message(oversized) if oversized else f"差异附件（{len(diffs)} 份，按顺序）：{batches}"
    if gap and not gap.startswith(".review-base"):
        coverage += f"\n复核基线提示：{gap}"
    paths = "\n".join(f"  {json.dumps(path, ensure_ascii=False)} → {name}" for path, name in sorted(index.items()))
    return f"""{GUIDE_TITLE}

对应提交：{change.head_label}（main）
差异范围：{change.base}..{change.head_label}（实际提交：{change.start}..{change.end}）
{coverage}
保留现有复核基线，不自动重置。

一、选择附件

只核对改动：只提供上方列出的差异附件，分卷时按编号顺序提供。差异待处理时先核对上方说明。
只核对某段历史：运行 python3 tools/review-copy.py 起点提交 终点提交，按需另存附件。
请用实际的提交号替换「起点提交」和「终点提交」。区间需分卷时，在命令末尾加 --part 1 可输出第一卷。
日常前后端源码、测试与文档体检：从以下互不重叠的前三组选取所需分卷，不同时提供差异附件：
{volumes}

前三组保留 data/x-posts/manifest.json；X 帖子正文是独立数据，不在日常代码附件中。
需要复核帖子正文或提供全部文本时，再按需附上第 4 组，不同时附差异附件：
{posts}

同一次提问不要重复提供相同内容。本说明无源码，按需提供即可。

二、格式与完整性

每个源文件整块保留，不跨卷拆开，每段以 ===== 文件路径 ===== 开头。
标记后的源码逐字节保留，包括缩进、空格、换行及是否有末尾换行。
文件之间额外的两个换行属于分隔框架，不属于源码。
不要手动重排或改写分卷。粘贴到聊天时可另加代码围栏，并保留文件名和缩进。
前三组和说明每个 txt 不超过 {CAP:,} 字节；每个差异附件不超过 {CHANGES_CAP:,} 字节，差异保留一行上下文。
差异能放进单份时使用 changes.txt，超出时按完整文件补丁顺序生成编号分卷。
第 4 组帖子正文每个 txt 不超过 {X_POSTS_CAP:,} 字节（{X_POSTS_CAP / 1_000_000:g} MB）。
数量按完整源文件体积自动调整，不丢弃已提交帖子正文。

三、附上背景和诉求

全站复核示例：这是稻网提交 {change.head_label} 的前后端源码，请检查可证实的功能和安全问题。
改动复核示例：这是 {change.start} 到 {change.end} 的 git diff，请检查本次改动是否引入回归。
具体故障请说明预期行为、实际行为和复现步骤。

四、报错与敏感信息

副本不附历史运行日志。如遇报错，请附本次完整 Error / Traceback、命令、步骤和环境。
保持日志的顺序、换行和缩进，只将真实密码、API 密钥或私人链接替换为 YOUR_KEY 或 xxx。
不导出 .env*、数据库、密钥、凭证、dist/、依赖、本地私有文件、图片和字体等二进制。
不导出生成的 js/auth.js（真实源码为 tools/auth-src.js）及两个 package-lock.json。
公开域名、公开代码链接和合成测试凭证不自动视为私人信息。
若源码中确有敏感值，应排除该文件或另制脱敏摘录，不把改写内容称作逐字节副本。

五、每次完成后的顺序

修改与测试 → 提交 → 推送 → 部署并核对两条工作流及线上版本 → 同步副本 → --check 校验。
维护者已授权 AI 执行本地同步和校验，替代此前的访问禁令。
本目录继续由 .gitignore 排除，不提交、不部署。
同步命令：python3 tools/sync-copy.py
校验命令：python3 tools/sync-copy.py --check
不自动执行 --mark-reviewed；仅在维护者明确要求时重置复核基线。

{GUIDE_INDEX_HEADING}{paths}
""".encode()


def review_gap(base, label="changes.txt"):
    # 临时指定较新的差异起点是允许的，所以缺口只提示、不判为失败，也不改 .review-base。
    saved = read_review_base()
    if saved is None:
        return None
    resolved = resolve_base(saved)
    if not resolved:
        return f".review-base 不是有效提交，无法核对 {label} 是否覆盖复核基线以来的改动"
    start = validate_base(base)
    if git_result("merge-base", "--is-ancestor", start, resolved).returncode == 0:
        return None
    count = git("rev-list", "--count", f"{resolved}..{start}").decode().strip()
    return f"{label} 从 {base} 开始，未覆盖复核基线 {saved} 以来的全部改动：{saved}..{base}（{count} 个提交）不在差异中"


def read_guide():
    try:
        with open(output_file(GUIDE), "rb") as source:
            return source.read(CAP + 1)
    except FileNotFoundError:
        return b""


def guide_change_parts(guide_bytes):
    # 只承认生成说明开头的连续批次表，不扫描正文中的文件名或孤立列表。
    if len(guide_bytes) > CAP:
        return set()
    try:
        lines = guide_bytes.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        return set()
    if len(lines) < 8 or lines[:2] != [GUIDE_TITLE, ""]:
        return set()
    span = GUIDE_COVERAGE.fullmatch(lines[3])
    listing = GUIDE_PART_LIST.fullmatch(lines[4])
    if not span or not listing:
        return set()
    base, short, start, end = span.groups()
    if lines[2] != f"对应提交：{short}（main）" or not end.startswith(short):
        return set()
    rest = 6 if lines[5].startswith("复核基线提示：") else 5
    if lines[rest:rest + 3] != ["保留现有复核基线，不自动重置。", "", "一、选择附件"]:
        return set()
    names = listing[2].split("、")
    if len(names) < 2 or len(names) != int(listing[1]) or any(name != f"changes-{i}.txt" for i, name in enumerate(names, 1)):
        return set()
    if resolve_base(start) != start or resolve_base(end) != end:
        return set()
    # 用说明记录的旧提交重算，清单不能自行增加卷名。保留旧标签以匹配当时的卷头大小。
    try:
        change = collect_changes(start, end)._replace(base=base, head_label=short)
        expected, _ = change_volumes(change)
    except SystemExit:
        return set()
    return set(names) if names == list(expected) else set()


def has_generated_part_header(name, part):
    with open(output_file(name), "rb") as source:
        if not CHANGE_HEADER.fullmatch(source.readline(16_384)):
            return False
        marker = PART_HEADER.fullmatch(source.readline(256))
    return marker is not None and int(marker[1]) == int(part[1]) and int(marker[2]) >= max(2, int(part[1]))


def existing_outputs(guide_bytes):
    managed, extra, unmarked = set(), [], set()
    for name in os.listdir(OUT):
        part = CHANGE_PART.fullmatch(name)
        if name in (GUIDE, "changes.txt") or SOURCE_VOLUME.fullmatch(name):
            output_file(name)
            managed.add(name)
        elif part:
            if has_generated_part_header(name, part):
                managed.add(name)
            else:
                unmarked.add(name)
        elif name.lower().endswith(".txt"):
            extra.append(name)
    listed = guide_change_parts(guide_bytes) if unmarked else set()
    managed.update(unmarked & listed)
    extra.extend(unmarked - listed)
    return managed, sorted(extra), listed


def check():
    output_directory()
    head = validate_base("HEAD")
    expected = dict(files(head))
    seen, actual_diffs, ok = {}, {}, True
    skipped_source_volumes = []
    actual_guide = read_guide()
    managed, extra, _ = existing_outputs(actual_guide)
    try:
        with open(output_file("sync.py"), "rb") as source:
            launcher = source.read(len(LAUNCHER) + 1)
    except FileNotFoundError:
        launcher = None
    if launcher != LAUNCHER:
        ok = False; print("  ❌ 兼容入口 sync.py 未同步")
    if os.path.lexists(os.path.join(OUT, ".DS_Store")):
        ok = False; print("  ❌ 副本目录含 .DS_Store，请重新同步以清理")
    for n in extra:
        ok = False; print(f"  ❌ 发现额外 txt，请维护者确认: {n}")
    names = sorted(managed - {GUIDE}, key=volume_order)
    for n in names:
        cap = limit(n)
        with open(output_file(n), "rb") as source:
            blob = source.read(cap + 1)
        is_diff = n == "changes.txt" or CHANGE_PART.fullmatch(n)
        if is_diff:
            actual_diffs[n] = blob
        if not blob:
            ok = False; print(f"  ❌ 空分卷: {n}"); continue
        if len(blob) > cap:
            ok = False; print(f"  ❌ {n} 超过 {cap:,} 字节")
            if not is_diff:
                skipped_source_volumes.append(n)
                continue
        if is_diff:
            continue
        pos = 0
        while pos < len(blob):
            header = re.match(rb"===== (.+?) =====\n", blob[pos:])
            p = header.group(1).decode() if header else None
            want = expected.get(p)
            if want is None or blob[pos:pos + len(section(p, want))] != section(p, want):
                ok = False; print(f"  ❌ {n} 中 {p or '分段头'} 与源码不一致"); break
            if p in seen or not n.startswith(group(p) + "-"):
                ok = False; print(f"  ❌ {p} 重复或分组错误")
            seen[p] = n
            pos += len(section(p, want))
    # 超限卷只读了前 cap + 1 字节，不能用未解析的卷判断该组缺少什么。
    skipped_groups = {n.rsplit("-", 1)[0] for n in skipped_source_volumes}
    missing = {p for p in expected.keys() - seen.keys() if not skipped_groups or group(p) not in skipped_groups}
    if missing:
        ok = False; print(f"  ❌ 缺少: {sorted(missing)}")
    span = GUIDE_RANGE.search(actual_guide.decode("utf-8", "replace"))
    gap, oversized = None, []
    if not span or not resolve_base(span[1]):
        ok = False; print("  ❌ 缺少有效使用说明或差异基线")
    else:
        change = collect_changes(span[1], head, short_head=True)
        diffs, oversized = change_volumes(change)
        if actual_diffs.keys() != diffs.keys():
            ok = False
            print(f"  ❌ 差异卷集合不符，预期 {sorted(diffs, key=volume_order)}，实际 {sorted(actual_diffs, key=volume_order)}")
        for name, content in diffs.items():
            if name in actual_diffs and actual_diffs[name] != content:
                ok = False; print(f"  ❌ {name} 与 git diff 不一致")
        gap = review_gap(change.base, "changes.txt" if "changes.txt" in diffs else "差异")
        expected_guide = guide(change, names, seen, diffs, oversized, gap)
        if skipped_source_volumes:
            # 缺少完整源码索引时，仍可核对说明中其他独立信息。
            heading = GUIDE_INDEX_HEADING.encode()
            guide_ok = heading in actual_guide and actual_guide.split(heading, 1)[0] == expected_guide.split(heading, 1)[0]
        else:
            guide_ok = actual_guide == expected_guide
        if not guide_ok or len(actual_guide) > CAP:
            ok = False; print(f"  ❌ 使用说明未同步或超过 {CAP:,} 字节")
    if gap:
        print(f"  ⚠️ {gap}")
    if validate_base("HEAD") != head:
        ok = False; print("  ❌ 核对期间 HEAD 变动，请重试")
    total = len(managed) + len(extra)
    if skipped_source_volumes:
        print("  ⚠️ 源码索引未核对，有超限源码卷")
        print(f"  已读取 {len(seen)} 个源文件，跳过 {len(skipped_source_volumes)} 个超限源码卷（应有 {len(expected)} 个源文件），{total} 个 txt，HEAD {head[:7]}")
    else:
        print(f"  {len(seen)}/{len(expected)} 个源文件，{total} 个 txt，HEAD {head[:7]}")
    if oversized:
        if ok:
            print("  ✅ 源码分卷与源码逐字节一致")
        print(f"  ❌ {oversized_message(oversized)}")
    if not ok:
        print("  ❌ 副本与源码不一致")
    elif not oversized:
        print("  ✅ 副本与源码逐字节一致")
    return ok and not oversized


def main():
    args = sys.argv[1:]
    if len(args) > 1 or args and args[0].startswith("-") and args not in (["--check"], ["--mark-reviewed"]):
        sys.exit(f"用法: python3 tools/sync-copy.py [base | --check | --mark-reviewed]（前三组及说明 ≤{CAP:,} 字节；差异 ≤{CHANGES_CAP:,} 字节；帖子正文 ≤{X_POSTS_CAP:,} 字节）")
    output_directory(create=args != ["--check"])
    output_file(".review-base")
    output_file("sync.py")
    if args == ["--check"]:
        sys.exit(0 if check() else 1)
    if args == ["--mark-reviewed"]:
        head = git("rev-parse", "--short", "HEAD").decode().strip()
        write_output(".review-base", (head + "\n").encode())
        print(f"  .review-base = {head}")
        return
    managed, extra, listed = existing_outputs(read_guide())
    if extra:
        sys.exit(f"发现额外 txt，未写入；请维护者确认: {extra}")
    saved = read_review_base() if not args else None
    if saved is not None:
        base = saved
        validate_base(base, ".review-base 不是有效提交，无法生成 changes.txt")
    else:
        base = args[0] if args else "HEAD~1"
        validate_base(base)
    change = collect_changes(base, "HEAD", short_head=True)
    vols, index = build(change.end)
    diffs, oversized = change_volumes(change)
    vols.update(diffs)
    gap = review_gap(base, "changes.txt" if "changes.txt" in diffs else "差异")
    explanation = guide(change, vols, index, diffs, oversized, gap)
    if len(explanation) > CAP:
        sys.exit(f"使用说明超过 {CAP:,} 字节，未写入")
    if validate_base("HEAD") != change.end:
        sys.exit("生成期间 HEAD 变动，未写入，请重试")
    metadata = os.path.join(OUT, ".DS_Store")
    if os.path.lexists(metadata):
        if os.path.islink(metadata) or not os.path.isfile(metadata):
            sys.exit(".DS_Store 不是普通文件，未写入，请维护者确认")
        os.remove(metadata)
    for n, data in vols.items():
        write_output(n, data)
    for n in managed - set(vols) - {GUIDE}:
        part = CHANGE_PART.fullmatch(n)
        if not part or n in listed or has_generated_part_header(n, part):
            os.remove(output_file(n))
    write_output(GUIDE, explanation)
    write_output("sync.py", LAUNCHER)
    vols[GUIDE] = explanation
    for n in sorted(vols, key=volume_order):
        print(f"  {n:24} {len(vols[n]):>7} B")
    sys.exit(0 if check() else 1)


if __name__ == "__main__":
    main()
