# The gate that ran nowhere, and the red nobody could read

**Date:** 2026-08-25
**Status:** shipped — both workflows

Three faults, found by turning one on.

## 1. The gate ran nowhere the work happens

Triggers were `branches: [backend]` and `[admin-panel]`. Every commit for weeks
has landed on `offline/v1/*`. So the suite ran **at merge time and nowhere
else** — a red branch could sit for weeks in silence and only announce itself
at the moment it was promoted, which is the moment it is most expensive.

Fixed: `branches: ['**']` for the gate; the deploy job fenced with
`if: github.ref == 'refs/heads/backend'` (and `admin-panel`). `needs: gate` says
the tests must pass; the `if:` says where a passing run is allowed to reach a
server holding shops' takings.

Verified on the first run: gate **success**, deploy **skipped**, on both.

## 2. A red gate that could not be read

The first run went red and said, to anybody without admin rights on the
repository: *"Process completed with exit code 1."*

Job **logs** need admin (`403 Must have admin rights`). Check-run
**annotations** do not — they were the only two facts available. So the gate now
emits `::error::` for the failing lines as well as writing a step summary. *A
gate nobody can diagnose is a gate nobody fixes.*

The step summary alone was not enough, and I shipped it before checking: it is
not carried by the check-runs API, so it is visible to exactly the people who
could already read the log.

## 3. The suite had been red all along — and said "2225 passed"

```
Tests:  1 warning, 2225 passed (9344 assertions)
Process completed with exit code 1
```

**No test failed.** `EveryTradeSellsTest::trades()` hands each data set three
arguments — type, item type, price — and
`test_a_cashier_of_this_trade_can_reach_the_till_at_all` accepts one. PHPUnit 11
warns when a data set is wider than the method it feeds, seven times over, and
that takes the process to exit 1.

It had been red for as long as the mismatch existed, on CI **and locally**.

### Why it was invisible

Every backend run came back summarised as
`{"tool":"phpunit","result":"passed","tests":2225,…}` — and that line has no
opinion about the exit code. "Backend green" was said all day on the strength of
a measurement that was not measuring the claim.

That is the fifth entry in
[measurement-that-lied](shopos-measurement-that-lied.md): wrong cwd, unquoted
heredoc, soft-deleted target, machine asleep, and now **a summary that swallowed
the exit code**.

The way through it, when stdout is being rewritten: make the tool write a file
and read the file.

```
./vendor/bin/phpunit --log-events-text /tmp/ev.txt
grep -c "Triggered PHPUnit Warning" /tmp/ev.txt
```

### The fix, and two shapes it deliberately is not

```php
public static function tradeNames(): array
{
    return array_map(static fn (array $row): array => [$row[0]], self::trades());
}
```

**Not three parameters with two ignored** — a signature that lies about what the
test reads.

**Not a second hand-written list of trades** — the more familiar mistake, and
one this repo has paid for repeatedly: two copies, and the day somebody adds the
eighth trade they update one of them.

Now: `SUITE EXIT=0`, zero warnings, 2225 passed, and both gates green on the
branches the work is actually on.

## What is left, and it is not a coding task

The deploy job fails on its one SSH step — `DEPLOY_SSH_KEY`. That is the
outstanding item and it belongs to whoever holds the droplet's keys.
