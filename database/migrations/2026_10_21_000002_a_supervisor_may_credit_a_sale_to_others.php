<?php

use App\Enums\UserRole;
use App\Support\Permissions;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `sales.credit_others` is new (the user, 2026-10-21): naming a colleague as
 * who served a sale now needs it. The Shift supervisor and Manager jobs carry
 * it, so the staff already doing those jobs — everyone who may discount past
 * the ceiling — keep naming colleagues, and keep reading as their job rather
 * than as Custom. Everybody else is held to themselves, which is the point.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->each(function (array $held): ?array {
            if (! in_array(Permissions::DISCOUNTS_OVERRIDE, $held, true) || in_array(Permissions::SALES_CREDIT_OTHERS, $held, true)) {
                return null;
            }
            $held[] = Permissions::SALES_CREDIT_OTHERS;

            return $held;
        });
    }

    public function down(): void
    {
        $this->each(fn (array $held): ?array => in_array(Permissions::SALES_CREDIT_OTHERS, $held, true)
            ? array_values(array_diff($held, [Permissions::SALES_CREDIT_OTHERS]))
            : null);
    }

    /** @param callable(array<int, string>): ?array<int, string> $change */
    private function each(callable $change): void
    {
        DB::table('users')
            ->where('role', UserRole::Staff->value)
            ->whereNotNull('tenant_id')
            ->orderBy('id')
            ->chunkById(200, function ($users) use ($change): void {
                foreach ($users as $user) {
                    $held = json_decode($user->permissions ?? '[]', true);
                    $now = is_array($held) ? $change($held) : null;

                    if ($now !== null) {
                        DB::table('users')->where('id', $user->id)->update(['permissions' => json_encode(array_values($now))]);
                    }
                }
            });
    }
};
