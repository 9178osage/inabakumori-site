#!/usr/bin/env python3
"""Print one committed review range using the source-copy export rules."""

import argparse
from pathlib import Path
import runpy
import sys


def main():
    parser = argparse.ArgumentParser(description="将两个提交之间的文本复核差异写到标准输出。")
    parser.add_argument("base", metavar="BASE", help="区间起点提交")
    parser.add_argument("head", metavar="END", help="区间终点提交")
    args = parser.parse_args()

    sync = runpy.run_path(str(Path(__file__).resolve().with_name("sync-copy.py")))
    validate = sync["validate_base"]
    base = validate(args.base, "无效的区间起点，请指定提交")
    head = validate(args.head, "无效的区间终点，请指定提交")
    ancestry = sync["git_result"]("merge-base", "--is-ancestor", base, head)
    if ancestry.returncode == 1:
        sys.exit(f"区间起点必须是终点的祖先：{base}..{head}")
    if ancestry.returncode:
        sys.exit("无法核对复核区间的祖先关系")

    diff = sync["changes"](base, head)
    cap = sync["CHANGES_CAP"]
    if len(diff) > cap:
        sys.exit(f"复核区间 {base}..{head} 的差异为 {len(diff):,} 字节，超过 {cap:,} 字节。请选取中间提交，分成更短的连续区间。")
    sys.stdout.buffer.write(diff)


if __name__ == "__main__":
    main()
