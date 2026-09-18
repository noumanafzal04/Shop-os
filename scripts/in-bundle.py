#!/usr/bin/env python3
"""
IS THIS STRING IN THE SHIPPED BUNDLE?

    python3 scripts/in-bundle.py <bundle-or-apk> "some text" ["more text" ...]

── Why this exists rather than `grep` ───────────────────────────────

Hermes stores a string containing any non-ASCII character as UTF-16, and
everything else as ASCII. So `grep` finds half the app's text and silently
misses the other half — every sentence with an em-dash or an arrow in it.

That produced a false alarm worth remembering: a verification pass reported
help topics as MISSING FROM THE BUILD, and the chase went to a stale-APK
theory before the encoding was checked. The content had been there all along.
A check that can only see half its subject is worse than no check, because it
is believed.
"""
import sys
import zipfile


def load(path: str) -> bytes:
    if path.endswith(".apk"):
        with zipfile.ZipFile(path) as z:
            return z.read("assets/index.android.bundle")
    with open(path, "rb") as f:
        return f.read()


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2

    data = load(sys.argv[1])
    missing = 0

    for needle in sys.argv[2:]:
        # Both encodings, always. Which one a string landed in depends on
        # whether it happens to contain a dash somebody typed.
        found = data.find(needle.encode()) >= 0 or data.find(needle.encode("utf-16-le")) >= 0
        print(("  ok   " if found else "  MISS ") + needle)
        missing += 0 if found else 1

    if missing:
        print(f"\n{missing} missing")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
