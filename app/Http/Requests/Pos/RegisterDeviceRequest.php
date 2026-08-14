<?php

namespace App\Http\Requests\Pos;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * A till announcing itself.
 *
 * Carries `sales.manage` rather than a settings permission: this is the cashier's
 * own browser saying "I am here" on every boot, not the owner configuring
 * anything. Listing and revoking devices are the owner's, and are gated
 * separately on the routes.
 */
class RegisterDeviceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        return [
            // Minted by the browser once and kept. A UUID rather than a
            // server-issued id so registration needs no round trip to discover
            // whether this device is already known — the same id simply
            // arrives again and touches the existing row.
            'device_id' => ['required', 'uuid'],
            // What a human calls it. Optional, and only ever overwrites a
            // stored name when actually sent: a boot with no name must not
            // blank the "Counter tablet" the shop typed.
            'name' => ['sometimes', 'nullable', 'string', 'max:80'],
            'platform' => ['sometimes', Rule::in(['web', 'android', 'ios'])],
            // What this till has done with the offline pricing engine so far —
            // the denominator under the variance count. Optional, because a
            // till on an older build has none to send and its boot must still
            // work; sent whole when sent at all, because a tally missing its
            // `checked` is a number with no meaning rather than a partial one.
            'shadow' => ['sometimes', 'array'],
            'shadow.checked' => ['required_with:shadow', 'integer', 'min:0'],
            'shadow.matched' => ['required_with:shadow', 'integer', 'min:0'],
            'shadow.skipped' => ['required_with:shadow', 'integer', 'min:0'],
            'shadow.differed' => ['required_with:shadow', 'integer', 'min:0'],
            'shadow.since' => ['required_with:shadow', 'date'],
        ];
    }
}
