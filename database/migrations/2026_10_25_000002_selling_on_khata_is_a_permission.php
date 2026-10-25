<?php

use App\Enums\UserRole;
use App\Support\Permissions;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `sales.on_credit` is new (wholesale #W6): putting a sale on a customer's
 * khata now needs it. Everybody who could ring a sale could put one on khata
 * until today, so everybody who holds sales.manage is given it — nothing that
 * worked stops working. The owner can now take it away from the one person
 * who should not lend the shop's money, such as an order booker.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->each(function (array $held): ?array {
            if (! in_array(Permissions::SALES_MANAGE, $held, true) || in_array(Permissions::SALES_ON_CREDIT, $held, true)) {
                return null;
            }
            $held[] = Permissions::SALES_ON_CREDIT;

            return $held;
        });
    }

    public function down(): void
    {
        $this->each(fn (array $held): ?array => in_array(Permissions::SALES_ON_CREDIT, $held, true)
            ? array_values(array_diff($held, [Permissions::SALES_ON_CREDIT]))
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
