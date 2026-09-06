# Icon licences

## Phosphor Icons — MIT

**Every icon in this app** is Phosphor path data, copied from
[`@phosphor-icons/core`][core] v2.1.1 into `src/common/ui/icons/index.tsx` —
83 glyphs at two weights, `assets/light/*.svg` and `assets/regular/*.svg`.

That file is GENERATED. The mapping from this app's names to Phosphor's own
lives in `scripts/build-icons.mjs`, which is the only place to edit; run
`node scripts/build-icons.mjs` to rebuild it. The script pins the version,
refuses an icon that is not a single stroke-free path on the expected grid, and
refuses two weights that turn out to be the same drawing.

The drawings are imported and the code is not — a few kilobytes of path data,
no package. Taken from the source repository rather than from a gallery that
mirrors it, so the licence travels with them and every shape can be diffed
against the file it came from.

```
MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

[core]: https://github.com/phosphor-icons/core

## Lucide — removed

`lucide-react-native` was this app's icon set and is no longer a dependency.
It is a good set; what it cannot do is a second WEIGHT, so a selected tab could
differ from an unselected one by half a point of stroke and nothing else. Once
the bar, the menus and the trade tiles had moved, keeping lucide for the rest
meant two families on the home screen — Phosphor tiles under a lucide header —
and two coherent sets mixed is worse than either alone.

## A note on gallery sites

Icons sourced from a gallery (SVG Repo and the like) must have their licence
checked **per collection**, not per site: those sites mirror sets under CC0, MIT,
Apache and CC BY together, and the last of those requires visible attribution.
Where a gallery mirrors an open-source set, take the files from the set's own
repository instead — the licence is unambiguous there and the version is
recorded.
