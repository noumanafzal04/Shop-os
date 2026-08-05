<?php

namespace App\Http\Requests\Admin;

use App\Support\Permissions;
use App\Support\PlanLimits;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Per-tenant limit change: raise (or clear) a single tenant's ceilings past its
 * plan baseline, for that tenant only.
 *
 * `mode` is the whole point of this class:
 *
 *   'add' — the number is how much MORE this tenant gets. "Extend by 100" on a
 *           ceiling of 1,000 lands on 1,100. This is what the word extend means
 *           and what an admin types when they are thinking about the increase.
 *   'set' — the number IS the new ceiling.
 *
 * Before this existed the endpoint only ever did 'set' behind a button labelled
 * Extend. An admin extending a 1,000-product tenant by 100 typed "100" and
 * silently CUT the ceiling to 100 — instantly putting a shop with 800 products
 * over its limit and blocking every new product, with no error and nothing on
 * screen to say what had happened. The guard in the controller closes the other
 * half of it: a ceiling can never be set below what the tenant already uses.
 */
class ExtendTenantLimitsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::TENANTS_UPDATE);
    }

    public function rules(): array
    {
        return [
            // Default 'set' keeps every existing caller (and the tests written
            // against them) behaving exactly as before; the panel always sends
            // its intent explicitly.
            'mode' => ['sometimes', Rule::in(['set', 'add'])],
            'limits' => ['required', 'array', 'min:1'],
            // 'add' accepts a negative — reducing an extension is a real thing
            // an admin does when a tenant downgrades. What it can never do is
            // land below live usage; the controller enforces that.
            'limits.*' => ['nullable', 'integer'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($v): void {
            $mode = $this->input('mode', 'set');

            foreach ($this->input('limits', []) as $key => $value) {
                if (! array_key_exists($key, PlanLimits::REGISTRY)) {
                    $v->errors()->add('limits', "Unknown limit: {$key}.");

                    continue;
                }

                // An absolute ceiling of zero or less is never meaningful —
                // "no products at all" is a suspension, not a limit.
                if ($mode === 'set' && $value !== null && (int) $value < 1) {
                    $v->errors()->add("limits.{$key}", 'A limit has to be at least 1.');
                }
            }
        });
    }
}
