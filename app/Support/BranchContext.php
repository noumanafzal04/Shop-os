<?php

namespace App\Support;

use App\Models\Branch;

/**
 * Holds the ACTIVE (operating) branch for the current request — the branch a
 * cashier is ringing sales on. Registered as a scoped singleton, resolved once
 * by the ResolveBranch middleware, consumed by the sale write-path.
 *
 * Like TenantContext, the active branch is never trusted from raw client input:
 * ResolveBranch validates any X-Branch-Id header against the tenant's branches
 * and the user's own assignment before setting it here. When unset (headless /
 * trusted paths with no request context) the sale path falls back to Main.
 */
class BranchContext
{
    private ?Branch $branch = null;

    /**
     * True when reads should span ALL branches (an owner's "All branches" HQ
     * view). The operating branch is still set (writes need a concrete branch),
     * but read scoping (dashboard/sales) treats the whole tenant as in scope.
     */
    private bool $scopeAll = false;

    public function set(?Branch $branch, bool $scopeAll = false): void
    {
        $this->branch = $branch;
        $this->scopeAll = $scopeAll;
    }

    /** The concrete OPERATING branch (writes: POS/sales decrement this). */
    public function get(): ?Branch
    {
        return $this->branch;
    }

    public function id(): ?string
    {
        return $this->branch?->id;
    }

    public function has(): bool
    {
        return $this->branch !== null;
    }

    /** Reads span all branches (owner HQ view). */
    public function scopesAll(): bool
    {
        return $this->scopeAll;
    }

    /**
     * The branch id to FILTER reads by, or null to include every branch.
     * Null means either "no branch context" or an explicit all-branches view.
     */
    public function scopeId(): ?string
    {
        return $this->scopeAll ? null : $this->branch?->id;
    }

    public function clear(): void
    {
        $this->branch = null;
        $this->scopeAll = false;
    }
}
