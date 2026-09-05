<?php

namespace App\Enums;

/**
 * Where a rider application stands.
 *
 * `pending` is the state a customer puts themselves in by applying; the other
 * three are verdicts, and only platform staff can write them. A rider never
 * moves their own status — that is the whole point of the gate.
 */
enum RiderStatus: string
{
    /**
     * The form is open and the photographs are not all in yet.
     *
     * A separate state from `pending` because "under review" is a promise that
     * somebody will look, and an application missing its CNIC back is not one
     * anybody can act on. The rider submits; that is what starts the clock.
     */
    case Draft = 'draft';
    case Pending = 'pending';
    case Approved = 'approved';
    case Rejected = 'rejected';
    case Suspended = 'suspended';

    /** May this rider be offered, accept, or carry work? */
    public function canRide(): bool
    {
        return $this === self::Approved;
    }

    /**
     * A rejected application can be fixed and sent again; a suspended one
     * cannot — that is a decision about the person, not the paperwork.
     */
    public function canReapply(): bool
    {
        return $this === self::Rejected;
    }

    /** Can the rider still change their own papers? */
    public function isEditable(): bool
    {
        return in_array($this, [self::Draft, self::Pending, self::Rejected], strict: true);
    }

    public function label(): string
    {
        return match ($this) {
            self::Draft => 'Not submitted',
            self::Pending => 'Under review',
            self::Approved => 'Approved',
            self::Rejected => 'Not approved',
            self::Suspended => 'Suspended',
        };
    }
}
