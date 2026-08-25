<?php

namespace App\Console\Commands;

use App\Actions\Tenant\DeleteTenantAction;
use App\Models\Tenant;
use Illuminate\Console\Command;

/**
 * Clears away demo shops whose day has run out.
 *
 * Without this the landing page is a slow leak: every visitor leaves a tenant,
 * an owner, a shelf and whatever they rang on it, for ever. The demo promises
 * on screen that the shop "clears itself away after a day", and a promise the
 * software does not keep is worse than not making it.
 *
 * Deletes through `DeleteTenantAction` rather than a bare `delete()`, so a demo
 * shop is removed exactly the way a real one is — one path, and it stays right
 * when a new table is added next month.
 *
 * `--dry-run` because the first thing anybody wants from a delete job is to see
 * what it WOULD take.
 */
class PruneDemoShops extends Command
{
    protected $signature = 'shopos:prune-demos {--dry-run : List what would go, and take nothing}';

    protected $description = 'Delete demo shops whose 24 hours are up';

    public function handle(DeleteTenantAction $delete): int
    {
        $expired = Tenant::query()
            ->where('is_demo', true)
            ->whereNotNull('demo_expires_at')
            ->where('demo_expires_at', '<', now())
            ->get();

        if ($expired->isEmpty()) {
            $this->components->info('No demo shops are past their day.');

            return self::SUCCESS;
        }

        foreach ($expired as $tenant) {
            if ($this->option('dry-run')) {
                $this->line("  would delete  {$tenant->business_name}  (ended {$tenant->demo_expires_at->diffForHumans()})");

                continue;
            }

            $delete->execute($tenant);
        }

        $this->components->info(
            $this->option('dry-run')
                ? "{$expired->count()} demo shop(s) are past their day."
                : "Cleared away {$expired->count()} demo shop(s)."
        );

        return self::SUCCESS;
    }
}
