#!/usr/bin/env python3
"""
Attributes that do not exist, read as if they did.

Eloquent answers `$product->branch_id` with **null** when there is no such
column, no cast, no accessor and no relation of that name. No error, no warning,
no log line. A typo, a renamed column, or a field somebody assumed was there
behaves exactly like a field that is legitimately empty — and "legitimately
empty" is a state this whole application is full of.

    $mainBranchId = $product->branch_id;   // products has no branch_id
                                           // → null, silently, for ever

That line was nearly written into a new action. It would have taken the branch
resolution to null, `openTheShelfFor` would have returned early, and a variant
added after creation would have had no `branch_stocks` row — which the till
reads as zero stock for something that is really on the shelf. A whole feature
degraded by a null nobody could see.

The question it raises is the reason this file exists: **if it can happen once,
where else has it already happened?**

    python3 silent-nulls.py            report
    python3 silent-nulls.py --prove    break the scanner first, and require it
                                       to look broken

── How it decides ──────────────────────────────────────────────────────────

PHP is not typed enough to resolve every `->` in the codebase, so this does the
tractable thing rather than the complete one: it only judges a read whose
variable NAMES its model. `$product->x` is judged against `Product`, `$sale->y`
against `Sale`. Anything ambiguous is not guessed at — it is counted as
UNJUDGED, printed as a denominator, and left alone.

For a name to be legitimate it has to be one of:

    a column          from the live schema, dumped per model
    a cast            including the `Attribute`-class style
    an accessor       getFooAttribute() or a `protected function foo(): Attribute`
    a relation        any method returning a relation type
    an append         $appends
    a stamped field   assigned as `$x->foo = …` somewhere — the pattern this
                      codebase uses for `branch_price` and `branch_stock`
    a framework thing pivot, exists, id, timestamps, wasRecentlyCreated…

── The honest limits, written down ─────────────────────────────────────────

  · A variable named after one model but holding another is judged wrongly. The
    `$appends`/stamped/relation allowances make that rare and one-directional:
    it produces false ALARMS, never false silence.
  · Traits and parent classes are read, so `BaseModel`'s casts count.
  · It cannot see a magic `__get`. No model here defines one; if one appears,
    this file will start lying and should be told about it.

A finding here is a LEAD, not a defect. Every one needs opening by hand — the
same rule `dead-endpoints.py` and `dead-rules.py` carry next door.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "app/Models"

# Things every Eloquent model answers to, that are nobody's column.
FRAMEWORK = {
    "id", "exists", "pivot", "timestamps", "incrementing", "keyType",
    "wasRecentlyCreated", "attributes", "original", "relations", "connection",
    "table", "primaryKey", "perPage", "casts", "guarded", "fillable", "hidden",
    "appends", "dates", "dateFormat", "with", "withCount", "forceDeleting",
    "usesUniqueIds", "preventsLazyLoading", "escapeWhenCastingToString",
}

# Where a `->name` is a method call or a chained builder, not an attribute read.
NOT_AN_ATTRIBUTE = re.compile(r"^\s*\(")


def schema() -> dict:
    """The live column list per model, dumped by artisan (see the README note)."""
    dump = Path("/tmp/models.json")
    if not dump.exists():
        subprocess.run(
            ["php", "artisan", "tinker", "--execute", _DUMPER],
            cwd=ROOT, capture_output=True, text=True,
        )
    if not dump.exists():
        print("could not dump the schema — is the database up?")
        raise SystemExit(2)

    return json.loads(dump.read_text())


_DUMPER = """
$out = [];
foreach (glob(base_path('app/Models/*.php')) as $f) {
  $cls = 'App\\\\Models\\\\'.basename($f, '.php');
  if (!class_exists($cls)) continue;
  $r = new ReflectionClass($cls);
  if ($r->isAbstract()) continue;
  try { $m = new $cls; } catch (\\Throwable $e) { continue; }
  try { $cols = \\Illuminate\\Support\\Facades\\Schema::getColumnListing($m->getTable()); }
  catch (\\Throwable $e) { $cols = []; }
  if (!$cols) continue;
  $out[$r->getShortName()] = ['table' => $m->getTable(), 'columns' => $cols];
}
file_put_contents('/tmp/models.json', json_encode($out));
"""


def model_source(name: str) -> str:
    """A model's own source plus the traits and parent it composes."""
    own = MODELS / f"{name}.php"
    if not own.exists():
        return ""
    text = own.read_text()

    # BaseModel carries casts and SoftDeletes for nearly everything here.
    parts = [text]
    for parent in re.findall(r"extends\s+(\w+)", text):
        p = MODELS / f"{parent}.php"
        if p.exists():
            parts.append(p.read_text())
    for trait in re.findall(r"use\s+([A-Z]\w*);", text):
        for cand in ROOT.glob(f"app/Models/Concerns/{trait}.php"):
            parts.append(cand.read_text())

    return "\n".join(parts)


def legitimate(name: str, src: str, columns: list[str], everything: str, blind: bool = False) -> set[str]:
    """Every attribute this model may legitimately answer to."""
    if blind:
        # Nothing is legitimate. The framework names go too — `->id` is read 267
        # times, and leaving them allowed made a fully blinded scanner still look
        # 68% right, which is not a shape anybody would recognise as broken.
        return set()

    ok = set(columns) | FRAMEWORK

    # casts(): both the array style and the Attribute-class style
    ok |= set(re.findall(r"'([a-z_0-9]+)'\s*=>\s*'", src))
    ok |= set(re.findall(r"'([a-z_0-9]+)'\s*=>\s*[A-Z]\w+::class", src))

    # accessors, old and new
    ok |= {_snake(m) for m in re.findall(r"function\s+get(\w+)Attribute\s*\(", src)}
    ok |= set(re.findall(r"function\s+([a-z]\w*)\s*\(\s*\)\s*:\s*Attribute", src))

    # relations — any method whose return type is a relation
    ok |= set(re.findall(
        r"function\s+(\w+)\s*\(\s*\)\s*:\s*(?:BelongsTo|HasMany|HasOne|BelongsToMany|"
        r"MorphMany|MorphTo|MorphOne|HasManyThrough|HasOneThrough)", src))

    # $appends
    for block in re.findall(r"\$appends\s*=\s*\[([^\]]*)\]", src):
        ok |= set(re.findall(r"'([a-z_0-9]+)'", block))

    # Stamped-on fields. This codebase deliberately hangs extra attributes on a
    # model before serialising — `branch_price`, `branch_stock` — so anything
    # ASSIGNED anywhere is legitimate to read.
    ok |= set(re.findall(r"->([a-z_][a-z_0-9]*)\s*=(?!=)", everything))

    # ── the two Eloquent idioms that MANUFACTURE attributes ─────────────
    #
    # Both of these were false alarms on the first run, and a scanner that cries
    # wolf five times is a scanner nobody opens the sixth time.
    #
    # `withCount('products')` puts `products_count` on the model. Allowed
    # codebase-wide rather than per model, because the count belongs to whichever
    # query asked for it and matching that to a variable is the same problem this
    # file already declines to guess at.
    ok |= {f"{rel}_count" for rel in re.findall(r"withCount\(\s*'(\w+)'", everything)}
    ok |= {f"{rel}_count" for block in re.findall(r"withCount\(\s*\[([^\]]*)\]", everything)
           for rel in re.findall(r"'(\w+)'", block)}
    ok |= {f"{rel}_sum_{col}" for rel, col in re.findall(r"withSum\(\s*'(\w+)'\s*,\s*'(\w+)'", everything)}

    # `selectRaw('avg(rating) as rating_avg')` — the alias is a real attribute on
    # every row the query returns.
    ok |= set(re.findall(r"\bas\s+([a-z_][a-z_0-9]*)\b", everything))

    return ok


def _snake(camel: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", camel).lower()


def report(mutate: str | None = None) -> tuple[int, int, int]:
    models = schema()
    if mutate == "blind":
        # The detector, told that every model has no columns and no members.
        models = {k: {"table": v["table"], "columns": []} for k, v in models.items()}

    php = sorted(ROOT.glob("app/**/*.php"))
    everything = "\n".join(f.read_text() for f in php)

    allowed = {}
    for name, info in models.items():
        src = "" if mutate == "blind" else model_source(name)
        allowed[name] = legitimate(
            name, src, info["columns"],
            "" if mutate == "blind" else everything,
            blind=mutate == "blind",
        )

    # Variable name → model. Only the unambiguous ones.
    by_var = {}
    for name in models:
        by_var[_snake(name)] = name

    findings, judged, unjudged = [], 0, 0
    for f in php:
        if "/Models/" in str(f):
            continue  # a model reading its own $this-> is a different question
        for lineno, line in enumerate(f.read_text().split("\n"), 1):
            if line.lstrip().startswith(("*", "//", "/*")):
                continue
            for var, attr in re.findall(r"\$([a-z][a-zA-Z0-9_]*)->([a-z_][a-z_0-9]*)\b(?!\s*\()", line):
                model = by_var.get(_snake(var))
                if model is None:
                    unjudged += 1
                    continue
                judged += 1
                if attr not in allowed[model]:
                    findings.append((f.relative_to(ROOT), lineno, f"${var}->{attr}", model, line.strip()[:88]))

    print(f"{len(models)} models · {judged} attribute reads judged · {unjudged} unjudged (variable does not name its model)\n")

    for path, lineno, expr, model, src in findings:
        print(f"  {expr:<34} {model:<18} {path}:{lineno}")
        print(f"      {src}")

    print(f"\n{len(findings)} of {judged} judged reads name nothing the model has")

    return len(findings), judged, unjudged


def prove() -> int:
    """
    Blind it, and require the result to LOOK blind.

    A scanner that judges nothing reports zero findings, which is
    character-for-character what a clean codebase reports. The only thing that
    tells them apart is the denominator, so this asserts on the denominator and
    never on the verdict.
    """
    print("── proving it can fail ──\n")
    found, judged, _ = report(mutate="blind")

    # Blinded, every judged read should look illegitimate.
    if judged == 0:
        print("\nBROKEN: the blinded run judged nothing, so it proves nothing")
        return 1
    if found != judged:
        print(f"\nBROKEN: blinded, only {found} of {judged} reads looked wrong — "
              "something is still allowing names through")
        return 1

    print(f"\nblinded: all {judged} judged reads reported. That is the shape of a "
          "scanner with nothing to compare against.\n")

    found, judged, _ = report()
    if judged == 0:
        print("\nBROKEN: the real run judged nothing either")
        return 1

    return 1 if found else 0


if __name__ == "__main__":
    if "--prove" in sys.argv:
        raise SystemExit(prove())
    raise SystemExit(1 if report()[0] else 0)
