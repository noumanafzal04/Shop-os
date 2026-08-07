<?php

use App\Enums\UserRole;
use App\Support\Permissions;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `tables.serve_any` is new, and enforcing it changes what existing staff can
 * do — a waiter who could settle any table yesterday would find half the floor
 * locked this morning, mid-service, with no warning.
 *
 * So: everybody who can work a floor today keeps working the whole floor. The
 * restriction only ever applies to a permission set an owner has since chosen —
 * which is exactly what the Waiter preset now does by omitting it.
 *
 * Scoped to `sales.manage` because that is the permission the dine-in routes
 * sit behind: someone without it could not touch a tab either way.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('users')
            ->where('role', UserRole::Staff->value)
            ->whereNotNull('tenant_id')
            ->orderBy('id')
            ->chunkById(200, function ($users): void {
                foreach ($users as $user) {
                    $held = json_decode($user->permissions ?? '[]', true);

                    if (! is_array($held) || ! in_array(Permissions::SALES_MANAGE, $held, true)) {
                        continue;
                    }
                    if (in_array(Permissions::TABLES_SERVE_ANY, $held, true)) {
                        continue;
                    }

                    $held[] = Permissions::TABLES_SERVE_ANY;

                    DB::table('users')->where('id', $user->id)
                        ->update(['permissions' => json_encode(array_values($held))]);
                }
            });
    }

    /**
     * Take it back off again, so a rollback leaves the permission lists as it
     * found them rather than seeded with a key nothing reads.
     */
    public function down(): void
    {
        DB::table('users')
            ->where('role', UserRole::Staff->value)
            ->whereNotNull('tenant_id')
            ->orderBy('id')
            ->chunkById(200, function ($users): void {
                foreach ($users as $user) {
                    $held = json_decode($user->permissions ?? '[]', true);

                    if (! is_array($held) || ! in_array(Permissions::TABLES_SERVE_ANY, $held, true)) {
                        continue;
                    }

                    DB::table('users')->where('id', $user->id)->update([
                        'permissions' => json_encode(array_values(
                            array_diff($held, [Permissions::TABLES_SERVE_ANY]),
                        )),
                    ]);
                }
            });
    }
};
