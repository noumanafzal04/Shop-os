<?php

namespace App\Support;

use App\Models\Register;

/**
 * Holds the ACTIVE terminal (register / lane) for the current request — the
 * physical station a cashier is standing at. Registered as a scoped singleton,
 * resolved once by the ResolveRegister middleware.
 *
 * Like TenantContext and BranchContext, the terminal is never trusted from raw
 * client input: ResolveRegister validates any X-Register-Id against the
 * tenant's own registers, the operating branch and the register's active flag
 * before setting it here. Null = a shop that doesn't use lanes (the whole
 * pre-register behaviour), which stays fully supported.
 */
class RegisterContext
{
    private ?Register $register = null;

    public function set(?Register $register): void
    {
        $this->register = $register;
    }

    public function get(): ?Register
    {
        return $this->register;
    }

    public function id(): ?string
    {
        return $this->register?->id;
    }

    public function has(): bool
    {
        return $this->register !== null;
    }

    public function clear(): void
    {
        $this->register = null;
    }
}
