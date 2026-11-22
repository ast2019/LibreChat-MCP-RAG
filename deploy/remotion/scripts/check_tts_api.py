"""Checks that src/tts.py calls edge-tts the way the pinned version accepts.

The keyword arguments tts.py passes to edge_tts.Communicate (and the Literal values it picks,
such as boundary="WordBoundary") are read from its source with `ast` and compared with the
signature recorded for the pinned version in edge-tts-api.json. No network and no edge-tts
install are needed. When edge_tts is importable at the pinned version (always in the Docker
image), the recorded signature is compared with the installed one as well.

Usage: python3 scripts/check_tts_api.py --version 7.3.1 [--tts src/tts.py] [--require-live]
Exit 0 when the call matches; 1 with one line per problem otherwise.
"""

import argparse
import ast
import inspect
import json
import os
import sys
import typing

HERE = os.path.dirname(os.path.abspath(__file__))


def communicate_calls(tree: ast.AST) -> list:
    calls = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "Communicate"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "edge_tts"
        ):
            calls.append(node)
    return calls


def compared_strings(tree: ast.AST) -> set:
    """String constants tts.py compares against (`chunk["type"] == "WordBoundary"`)."""
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare):
            for part in [node.left, *node.comparators]:
                if isinstance(part, ast.Constant) and isinstance(part.value, str):
                    found.add(part.value)
    return found


def live_signature() -> dict:
    import edge_tts  # noqa: PLC0415 - optional

    params = inspect.signature(edge_tts.Communicate.__init__).parameters
    out = {"version": edge_tts.__version__, "positional": [], "keywords": {}}
    for name, param in params.items():
        if name == "self":
            continue
        if param.kind == param.KEYWORD_ONLY:
            values = typing.get_args(param.annotation) if typing.get_origin(param.annotation) is typing.Literal else None
            out["keywords"][name] = list(values) if values else None
        else:
            out["positional"].append(name)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--tts", default=os.path.join(HERE, "..", "src", "tts.py"))
    parser.add_argument("--api", default=os.path.join(HERE, "edge-tts-api.json"))
    parser.add_argument("--require-live", action="store_true")
    args = parser.parse_args()

    with open(args.api, encoding="utf-8") as handle:
        recorded = json.load(handle).get(args.version)
    if recorded is None:
        print(
            f"edge-tts {args.version} has no recorded signature in {os.path.basename(args.api)}: "
            "install that version and record Communicate's keyword arguments there"
        )
        return 1
    problems = []
    with open(args.tts, encoding="utf-8") as handle:
        tree = ast.parse(handle.read(), args.tts)
    calls = communicate_calls(tree)
    if not calls:
        problems.append("tts.py does not call edge_tts.Communicate")
    for call in calls:
        if len(call.args) > len(recorded["positional"]):
            problems.append(f"line {call.lineno}: {len(call.args)} positional arguments, the API takes {len(recorded['positional'])}")
        for keyword in call.keywords:
            allowed = recorded["keywords"].get(keyword.arg, "missing")
            if allowed == "missing":
                problems.append(f"line {call.lineno}: edge-tts {args.version} Communicate has no {keyword.arg}=")
            elif allowed and isinstance(keyword.value, ast.Constant) and keyword.value.value not in allowed:
                problems.append(f"line {call.lineno}: {keyword.arg}={keyword.value.value!r} is not one of {allowed}")
        boundary = next((k.value.value for k in call.keywords if k.arg == "boundary" and isinstance(k.value, ast.Constant)), None)
        if boundary and boundary not in compared_strings(tree):
            problems.append(f"line {call.lineno}: boundary={boundary!r} but tts.py never reads {boundary} chunks")

    try:
        live = live_signature()
    except ImportError:
        live = None
        if args.require_live:
            problems.append("edge_tts is not installed")
    if live is not None:
        if live["version"] != args.version:
            if args.require_live:
                problems.append(f"edge_tts {live['version']} is installed, the pin is {args.version}")
            else:
                print(f"note: edge_tts {live['version']} installed, not the pinned {args.version}; checked the recorded signature only")
        elif live["positional"] != recorded["positional"] or live["keywords"] != recorded["keywords"]:
            problems.append(f"the recorded signature for {args.version} differs from the installed one: {json.dumps(live)}")

    for problem in problems:
        print(problem)
    if not problems:
        print(f"tts.py matches edge-tts {args.version}" + (" (installed and recorded)" if live and live["version"] == args.version else " (recorded)"))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
