<?php

namespace App\Http\Requests\Concerns;

use Illuminate\Database\Eloquent\Model;

/**
 * A PARTIAL UPDATE IS VALIDATED AGAINST THE RECORD AS IT WILL BE.
 *
 * Several rules in this codebase depend on another field: a coupon's `value`
 * may not exceed 100 when its `type` is `percent`, a promotion's `buy_qty` is
 * required only for `bogo`. On a CREATE that is straightforward, because every
 * field the rule leans on is required and therefore present.
 *
 * On an update it is not, and the obvious spelling is wrong:
 *
 *     $type = $this->input('type', 'percent');   // ← a guess
 *
 * A shop raising a Rs 50 fixed promotion to Rs 5,000, without resending a
 * `type` it was not changing, was told **"value must not be greater than
 * 100"** — a percentage rule applied to a rupee amount, naming a field the
 * shop had not touched. The edit is refused and the message explains nothing.
 *
 * So the missing half comes off the ROW, not off a default. What the record
 * will look like after the edit is the only thing worth validating against.
 */
trait ValidatesAgainstTheStoredRecord
{
    /**
     * The value of `$field` after this request lands: what was sent, or what
     * the stored row already holds.
     *
     * Tenant-scoped by the model's own global scope, so it can never read
     * another shop's row to decide this shop's rules.
     *
     * @param  class-string<Model>  $model
     */
    protected function effective(string $field, string $model, string $routeKey, mixed $default = null): mixed
    {
        if ($this->has($field)) {
            return $this->input($field);
        }

        $id = $this->route($routeKey);

        if (! is_string($id) || $id === '') {
            return $default;
        }

        return $model::query()->whereKey($id)->value($field) ?? $default;
    }
}
