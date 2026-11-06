#!/usr/bin/env python3
"""Print one committed review range using the source-copy export rules."""

import argparse
import os
from pathlib import Path
import stat
import sys

TOOLS_DIRECTORY_ERROR = "tools 必须是真实目录，不得使用符号链接"
MAX_SYMLINK_HOPS = 40


def check_tool_detours(parent):
    # Reject canceled links at or below tools using their original paths. Do not
    # use this lexical stack to resolve ancestors: jump/.. follows jump first.
    prefix = Path(parent.anchor)
    prefixes = []
    for part in parent.parts[1:]:
        prefix /= part
        if part != "..":
            prefixes.append(prefix)
        elif prefixes:
            within_tools = any(path.name.casefold() == "tools" for path in prefixes)
            canceled = prefixes.pop()
            if within_tools and canceled.is_symlink():
                sys.exit(TOOLS_DIRECTORY_ERROR)


def entry_parent(entry):
    parent = entry.parent
    for _ in range(MAX_SYMLINK_HOPS):
        if ".." not in parent.parts:
            return parent
        check_tool_detours(parent)

        # Remove trailing '..' over real directories. When a climb crosses an
        # external link, expand just that link before climbing. Checking the
        # expanded spelling keeps links hidden in its target visible as well.
        climb = 0
        while climb or parent.name == "..":
            if parent.name == "..":
                climb += 1
            else:
                mode = parent.lstat().st_mode
                if stat.S_ISLNK(mode):
                    target = parent.parent / os.readlink(parent)
                    parent = target.joinpath(*([".."] * climb))
                    break
                if not stat.S_ISDIR(mode):
                    sys.exit(TOOLS_DIRECTORY_ERROR)
                climb -= 1
            parent = parent.parent
        else:
            return parent
    sys.exit("无法定位 tools/review-copy.py，请检查目录符号链接")


def load_sync():
    # Follow entry-file aliases without resolving away any tools-directory link.
    # Aliases above the checkout (such as /var on macOS) remain usable.
    entry = Path(__file__).absolute()
    try:
        for _ in range(MAX_SYMLINK_HOPS):
            tools = entry_parent(entry)
            entry = tools / entry.name
            if tools.name.casefold() == "tools" and tools.is_symlink():
                sys.exit(TOOLS_DIRECTORY_ERROR)
            if not entry.is_symlink():
                break
            entry = tools / os.readlink(entry)
        else:
            sys.exit("无法定位 tools/review-copy.py，请检查入口符号链接")
        directory = tools.lstat()
        if tools.name.casefold() != "tools" or not stat.S_ISDIR(directory.st_mode):
            sys.exit(TOOLS_DIRECTORY_ERROR)
        target = tools.parent.resolve() / "tools" / "sync-copy.py"
        expected = target.lstat()
        if not stat.S_ISREG(expected.st_mode):
            sys.exit("tools/sync-copy.py 必须是普通文件，不得使用符号链接")
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0)
        descriptor = os.open(target, flags)
        with os.fdopen(descriptor, "rb") as source:
            opened = os.fstat(descriptor)
            same_directory = os.path.samestat(directory, target.parent.lstat())
            same_source = os.path.samestat(expected, opened) and os.path.samestat(opened, target.lstat())
            if not (same_directory and same_source and stat.S_ISREG(opened.st_mode)):
                sys.exit("读取期间 tools/sync-copy.py 路径已变化，请重试")
            code = compile(source.read(), str(target), "exec")
    except OSError:
        sys.exit("无法读取 tools/sync-copy.py。生成器必须是普通文件，不得使用符号链接")
    sync = {"__name__": "_review_copy_sync", "__file__": str(target)}
    exec(code, sync)
    return sync


def main():
    parser = argparse.ArgumentParser(description="将两个提交之间的文本复核差异写到标准输出。")
    parser.add_argument("base", metavar="BASE", help="区间起点提交")
    parser.add_argument("head", metavar="END", help="区间终点提交")
    parser.add_argument("--part", metavar="N", type=int, help="只输出指定编号的差异卷，从 1 开始")
    args = parser.parse_args()
    if args.part is not None and args.part < 1:
        parser.error("--part 必须是从 1 开始的整数")

    sync = load_sync()
    validate = sync["validate_base"]
    base = validate(args.base, "无效的区间起点，请指定提交")
    head = validate(args.head, "无效的区间终点，请指定提交")
    ancestry = sync["git_result"]("merge-base", "--is-ancestor", base, head)
    if ancestry.returncode == 1:
        sys.exit(f"区间起点必须是终点的祖先：{base}..{head}")
    if ancestry.returncode:
        sys.exit("无法核对复核区间的祖先关系")

    change = sync["collect_changes"](base, head)
    volumes, oversized = sync["change_volumes"](change)
    if oversized:
        sys.exit(sync["oversized_message"](oversized))
    total = len(volumes)
    if args.part is None and total > 1:
        size = len(change.header()) + len(change.notes) + len(change.patch)
        cap = sync["CHANGES_CAP"]
        sys.exit(f"复核区间 {base}..{head} 的差异为 {size:,} 字节，超过 {cap:,} 字节。"
                 f"请选取中间提交，分成更短的连续区间，或使用 --part 按卷导出（共 {total} 卷）。\n"
                 f"python3 tools/review-copy.py {base} {head} --part 1")
    part = args.part if args.part is not None else 1
    if part > total:
        sys.exit(f"此区间共 {total} 卷，--part 须在 1 至 {total} 之间")
    filename = "changes.txt" if total == 1 else f"changes-{part}.txt"
    sys.stdout.buffer.write(volumes[filename])


if __name__ == "__main__":
    main()
