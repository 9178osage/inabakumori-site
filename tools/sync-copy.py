#!/usr/bin/env python3
"""稻网（inabakumori-site）源码文本副本。副本 = git HEAD 的逐字节拷贝，不做任何替换。

规则（用户 2026-10-20 将代码上限恢复为 130,000 字节，帖子正文单独归档）：
  1. 每段以 `===== 文件路径 =====` 开头，内容与 `git show HEAD:<路径>` 逐字节相同。
  2. 按文件拆分，单个文件绝不切开；代码、说明和差异每个 txt 不超过 CAP 字节。
  3. 四组互不重叠：1-app-code / 2-tools-tests / 3-docs / 4-x-posts；帖子正文上限为 X_POSTS_CAP。
  4. txt 文件数量按完整源文件体积自动调整，包含使用说明和 changes.txt。
  5. 只读 git 跟踪的文件，排除 js/auth.js（源码是 tools/auth-src.js）、两个 package-lock.json、
     二进制文件，以及 dist/、.env*、数据库、密钥和本地私有文件。
  6. 输出文件夹已被 .gitignore 忽略，永不提交、不上线；生成器在 tools/ 中受版本控制。

用法
  python3 tools/sync-copy.py [<base>]         生成副本 + changes.txt（<base>..HEAD，默认读 .review-base）
  python3 tools/sync-copy.py --check          只核对，不写任何文件
  python3 tools/sync-copy.py --mark-reviewed  把 HEAD 记为新的 .review-base
"""
import os, re, stat, subprocess, sys, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "inabakumori-site-all-code")
BASE_FILE = os.path.join(OUT, ".review-base")
CAP = 130_000
X_POSTS_CAP = 140_000_000  # 第 4 组数据单独打包，按十进制字节计。
GUIDE = "0-使用说明.txt"
EXCLUDE = {"js/auth.js", "package-lock.json", "backend/package-lock.json"}
BINARY = re.compile(r"\.(png|jpe?g|webp|gif|ico|avif|bmp|tiff?|svgz|eot|woff2?|ttf|otf|mp[34]|ogg|m4a|wav|flac|webm|mov|zip|gz|7z|pdf|dmp|ai|db|sqlite3?)(?:-(?:wal|shm|journal))?$", re.I)
PRIVATE = re.compile(r"(?:^|[/_.-])(?:secrets?|credentials?|private[-_]?key|id_rsa|id_ed25519)(?:$|[/_.-])|\.(?:pem|key|p12|pfx|jks|keystore|sql|dump|bak)$", re.I)
GENERATED = re.compile(r"^(?:(?:1-app-code|2-tools-tests|3-docs|4-x-posts)-\d+|changes)\.txt$")
X_POSTS_FILE = re.compile(r"^data/x-posts/posts-[^/]+\.json$")
APP_ROOT = {"index.html", "updates.html", "404.html", "style.css", "updates.css", "script.js", "site.webmanifest", "robots.txt",
            "sitemap.xml", "package.json", "CNAME", ".nojekyll", "tools/auth-src.js"}


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
    if X_POSTS_FILE.fullmatch(p):
        return "4-x-posts"
    if p.endswith(".md") or p.startswith("docs/"):
        return "3-docs"
    if p in APP_ROOT or p.startswith(("js/", "backend/", "fonts/", "data/")):
        return "1-app-code"
    return "2-tools-tests"  # tools/、.github/、.gitignore、.npmrc 以及其余配置


def limit(name):
    return X_POSTS_CAP if name == "4-x-posts" or name.startswith("4-x-posts-") else CAP


def volume_order(name):
    match = re.fullmatch(r"(.+)-(\d+)\.txt", name)
    return (match.group(1), int(match.group(2)), name) if match else (name, 0, name)


def git(*args):
    r = subprocess.run(["git", *args], cwd=REPO, capture_output=True)
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


def files():
    out = []
    for p in git("ls-tree", "-r", "--name-only", "-z", "HEAD").decode().split("\0"):
        if not p or not allowed(p):
            continue
        data = git("show", f"HEAD:{p}")
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


def build():
    vols = {}
    for p, data in files():
        g = group(p)
        piece = section(p, data)
        cap = limit(g)
        if len(piece) > cap:
            sys.exit(f"{p} 单个文件就超过 {cap:,} 字节，无法放进副本")
        parts = vols.setdefault(g, [[]])
        if sum(map(len, parts[-1])) + len(piece) > cap:
            parts.append([])
        parts[-1].append(piece)
    result = {}
    for g in sorted(vols):
        for i, chunk in enumerate(vols[g], 1):
            result[f"{g}-{i}.txt"] = b"".join(chunk)
    return result


def validate_base(base):
    if not base or base.startswith("-") or any(character.isspace() for character in base):
        sys.exit("无效的复核基线")
    git("rev-parse", "--verify", "--end-of-options", f"{base}^{{commit}}")


def changes(base):
    validate_base(base)
    paths = []
    for raw in git("diff", "--no-renames", "--name-only", "-z", f"{base}..HEAD").split(b"\0"):
        if not raw:
            continue
        p = raw.decode("utf-8")
        if not allowed(p):
            continue
        # 删除或修改的文件也检查旧版本，防止二进制/敏感文件混进 diff。
        for ref in (base, "HEAD"):
            r = subprocess.run(["git", "show", f"{ref}:{p}"], cwd=REPO, capture_output=True)
            if r.returncode == 0 and not is_text(r.stdout):
                break
        else:
            paths.append(p)
    diff = git("--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames",
               f"{base}..HEAD", "--", *paths) if paths else b""
    head = git("rev-parse", "--short", "HEAD").decode().strip()
    return f"# changes {base}..{head}（仅含符合导出规则的文本文件）\n".encode() + diff


def guide(base, names):
    head = git("rev-parse", "--short", "HEAD").decode().strip()
    ordered = sorted(names, key=volume_order)
    volumes = "\n".join("  " + n for n in ordered if n.startswith(("1-app-code-", "2-tools-tests-", "3-docs-")))
    posts = "\n".join("  " + n for n in ordered if n.startswith("4-x-posts-")) or "  （本次没有帖子正文分卷）"
    return f"""稻网源码文本副本 · 使用说明

对应提交：{head}（main）
差异范围：{base}..{head}；保留现有复核基线，不自动重置。

一、选择附件

只核对改动：只提供 changes.txt。
日常前后端源码、测试与文档体检：提供以下互不重叠的前三组，不同时提供 changes.txt：
{volumes}

前三组保留 data/x-posts/manifest.json；X 帖子正文是独立数据，不在日常代码附件中。
需要复核帖子正文或提供全部文本时，再按需附上第 4 组，不同时附 changes.txt：
{posts}

同一次提问不要重复提供相同内容。本说明无源码，按需提供即可。

二、格式与完整性

每个源文件整块保留，不跨卷拆开，每段以 ===== 文件路径 ===== 开头。
标记后的源码逐字节保留，包括缩进、空格、换行及是否有末尾换行。
文件之间额外的两个换行属于分隔框架，不属于源码。
不要手动重排或改写分卷。粘贴到聊天时可另加代码围栏，并保留文件名和缩进。
前三组、说明和 changes.txt 每个 txt 不超过 {CAP:,} 字节。
第 4 组帖子正文每个 txt 不超过 {X_POSTS_CAP:,} 字节（{X_POSTS_CAP / 1_000_000:g} MB）。
数量按完整源文件体积自动调整，不丢弃已提交帖子正文。

三、附上背景和诉求

全站复核示例：这是稻网提交 {head} 的前后端源码，请检查可证实的功能和安全问题。
改动复核示例：这是 {base} 到 {head} 的 git diff，请检查本次改动是否引入回归。
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
""".encode()


def check():
    output_directory()
    expected = dict(files())
    seen, ok, base = {}, True, None
    if os.path.lexists(os.path.join(OUT, ".DS_Store")):
        ok = False; print("  ❌ 副本目录含 .DS_Store，请重新同步以清理")
    text_names = sorted((n for n in os.listdir(OUT) if n.lower().endswith(".txt")), key=volume_order)
    for n in text_names:
        if n != GUIDE and not GENERATED.match(n):
            ok = False; print(f"  ❌ 发现额外 txt，请维护者确认: {n}")
    names = sorted((n for n in os.listdir(OUT) if GENERATED.match(n)), key=volume_order)
    for n in names:
        blob = open(output_file(n), "rb").read()
        if not blob:
            ok = False; print(f"  ❌ 空分卷: {n}"); continue
        cap = limit(n)
        if len(blob) > cap:
            ok = False; print(f"  ❌ {n} 超过 {cap:,} 字节")
        if n == "changes.txt":
            header = re.match(rb"# changes (\S+)\.\.([0-9a-f]+)[^\n]*\n", blob)
            if not header or blob != changes(header.group(1).decode()):
                ok = False; print("  ❌ changes.txt 与 git diff 不一致")
            if header:
                base = header.group(1).decode()
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
    missing = set(expected) - set(seen)
    if missing:
        ok = False; print(f"  ❌ 缺少: {sorted(missing)}")
    guide_path = output_file(GUIDE)
    if not base or not os.path.isfile(guide_path):
        ok = False; print("  ❌ 缺少有效使用说明或差异基线")
    else:
        with open(guide_path, "rb") as source:
            actual_guide = source.read()
        if actual_guide != guide(base, names) or len(actual_guide) > CAP:
            ok = False; print(f"  ❌ 使用说明未同步或超过 {CAP:,} 字节")
    total = len(text_names)
    if "changes.txt" not in names:
        ok = False; print("  ❌ 缺少 changes.txt")
    head = git("rev-parse", "--short", "HEAD").decode().strip()
    print(f"  {len(seen)}/{len(expected)} 个源文件，{total} 个 txt，HEAD {head}")
    print("  ✅ 副本与源码逐字节一致" if ok else "  ❌ 副本与源码不一致")
    return ok


def main():
    args = sys.argv[1:]
    if len(args) > 1 or args and args[0].startswith("-") and args not in (["--check"], ["--mark-reviewed"]):
        sys.exit(f"用法: python3 tools/sync-copy.py [base | --check | --mark-reviewed]（前三组及差异 ≤{CAP:,} 字节；帖子正文 ≤{X_POSTS_CAP:,} 字节）")
    output_directory(create=args != ["--check"])
    output_file(".review-base")
    for name in os.listdir(OUT):
        if name == GUIDE or GENERATED.match(name):
            output_file(name)
    if args == ["--check"]:
        sys.exit(0 if check() else 1)
    if args == ["--mark-reviewed"]:
        head = git("rev-parse", "--short", "HEAD").decode().strip()
        write_output(".review-base", (head + "\n").encode())
        print(f"  .review-base = {head}")
        return
    extra = [n for n in os.listdir(OUT) if n.lower().endswith(".txt") and n != GUIDE and not GENERATED.match(n)]
    if extra:
        sys.exit(f"发现额外 txt，未写入；请维护者确认: {sorted(extra)}")
    if args:
        base = args[0]
    elif os.path.exists(BASE_FILE):
        base = open(BASE_FILE).read().strip()
    else:
        base = "HEAD~1"
    validate_base(base)
    vols = build()
    diff = changes(base)
    if len(diff) <= CAP:
        vols["changes.txt"] = diff
    else:
        sys.exit(f"changes.txt 有 {len(diff)} B，超过 {CAP:,} 字节；请换一个更近的 base")
    vols[GUIDE] = guide(base, vols)
    if len(vols[GUIDE]) > CAP:
        sys.exit(f"使用说明超过 {CAP:,} 字节，未写入")
    metadata = os.path.join(OUT, ".DS_Store")
    if os.path.lexists(metadata):
        if os.path.islink(metadata) or not os.path.isfile(metadata):
            sys.exit(".DS_Store 不是普通文件，未写入，请维护者确认")
        os.remove(metadata)
    for n in os.listdir(OUT):
        if GENERATED.match(n) and n not in vols:
            os.remove(output_file(n))
    for n, data in vols.items():
        write_output(n, data)
    for n in sorted(vols, key=volume_order):
        print(f"  {n:24} {len(vols[n]):>7} B")
    sys.exit(0 if check() else 1)


if __name__ == "__main__":
    main()
