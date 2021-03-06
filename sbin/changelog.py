#!/usr/bin/env python

import argparse
import re
import subprocess
import sys

import utils

GITHUB_COMPARE_URL = (
    "https://github.com/AxisCommunications/practical-react-components/compare"
)
GITHUB_COMMIT_URL = (
    "https://github.com/AxisCommunications/practical-react-components/commit"
)

GROUP_TITLES = {
    "feat": "🚀 Features",
    "fix": "🐛 Bug fixes",
    "refactor": "🧰 Refactoring",
    "docs": "📝 Documentation",
    "chore": "🚧 Maintenance",
    "ci": "🚦 Continous integration",
}


def changelog_part(commitish_to: str, commitish_from: str, version: str):
    date = utils.cmd(["git", "log", "-1", "--format=%ci", commitish_to])

    commit_range = (
        f"{commitish_from}..HEAD"
        if commitish_to == "HEAD"
        else f"{commitish_from}..{commitish_to}~"
    )

    commits = utils.cmd(
        ["git", "log", "--no-merges", "--date-order", "--format=%H%x09%s", commit_range]
    )

    messages = {}

    for commit in commits.split("\n"):
        sha, msg = commit.split(maxsplit=1)
        shortsha = utils.cmd(["git", "log", "-1", "--format=%h", sha])

        try:
            data = utils.conventional_commit_parse(msg)
            messages.setdefault(data["type"], []).append(
                {**data, "sha": sha, "shortsha": shortsha}
            )
        except:
            # No conventional commit
            pass

    content = [
        f"## [{version}]({GITHUB_COMPARE_URL}/{commitish_from}...{version}) ({date})"
    ]

    for group in GROUP_TITLES.keys():
        if group not in messages:
            continue

        content.append(f"\n### {GROUP_TITLES[group]}\n")

        for data in messages[group]:

            prefix = (
                f'  - **{data["scope"]}**: ' if data["scope"] is not None else "  - "
            )
            postfix = f' ([{data["shortsha"]}]({GITHUB_COMMIT_URL}/{data["sha"]}))'

            if data["breaking"]:
                content.append(f'{prefix}**BREAKING** {data["description"]}{postfix}')
            else:
                content.append(f'{prefix} {data["description"]}{postfix}')

    return "\n".join(content)


HEADER = """
# Changelog

All notable changes to this project will be documented in this file.

"""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate or update a CHANGELOG.md file."
    )

    parser.add_argument(
        "-s",
        "--skip-header",
        action="store_true",
        help="Don't include a changelog header",
    )

    subparsers = parser.add_subparsers(dest="type")

    single = subparsers.add_parser(
        "single", description="Changelog for a single release"
    )
    single.add_argument("-tag", "--tag", type=str, metavar="TAG")

    full = subparsers.add_parser("full")
    full.add_argument(
        "-release",
        "--release",
        type=str,
        metavar="RELEASE",
        help="New relase, includes full changelog with a new entry for things not tagged",
    )

    args = parser.parse_args()

    tags = utils.cmd(
        [
            "git",
            "-c",
            "versionsort.suffix=-alpha",
            "tag",
            "--list",
            "--sort=-version:refname",
            "--merged",
            "HEAD",
        ]
    ).split()
    if args.type == "full" and args.release is not None:
        tags.insert(0, "HEAD")

    content = [HEADER] if not args.skip_header else []

    for commitish_to, commitish_from in zip(tags[:-1], tags[1:]):
        if args.type == "single" and args.tag != commitish_to:
            continue

        content.append(
            changelog_part(
                commitish_to,
                commitish_from,
                args.release if commitish_to == "HEAD" else commitish_to,
            )
        )
        content.append("")

    sys.stdout.write("\n".join(content))
    sys.stdout.close()
