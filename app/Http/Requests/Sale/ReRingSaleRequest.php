<?php

namespace App\Http\Requests\Sale;

/**
 * The new bill of a re-ring (Q19 B): a sale like any other — the same rules,
 * the same permission to ring it — whose tender is only the DIFFERENCE, since
 * what was already paid is carried over by the server. And, like a void, a
 * supervisor's PIN when the person ringing it may not cancel a bill alone.
 */
class ReRingSaleRequest extends StoreSaleRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            ...parent::rules(),
            'approval' => ['nullable', 'array'],
            'approval.user_id' => ['required_with:approval', 'uuid'],
            'approval.pin' => ['required_with:approval', 'string', 'max:12'],
        ];
    }
}
