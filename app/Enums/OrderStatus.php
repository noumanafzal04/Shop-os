<?php

namespace App\Enums;

enum OrderStatus: string
{
    case Pending = 'pending';
    case Confirmed = 'confirmed';
    case Preparing = 'preparing';
    case Ready = 'ready';
    case OutForDelivery = 'out_for_delivery';
    case Completed = 'completed';
    case Cancelled = 'cancelled';

    /**
     * Allowed forward transitions per the fulfillment flow.
     *
     * @return self[]
     */
    public function nextStates(string $fulfillmentType): array
    {
        return match ($this) {
            self::Pending => [self::Confirmed, self::Cancelled],
            self::Confirmed => [self::Preparing, self::Cancelled],
            self::Preparing => $fulfillmentType === 'delivery'
                ? [self::OutForDelivery, self::Cancelled]
                : [self::Ready, self::Cancelled],
            self::Ready, self::OutForDelivery => [self::Completed, self::Cancelled],
            self::Completed, self::Cancelled => [],
        };
    }

    public function isOpen(): bool
    {
        return ! in_array($this, [self::Completed, self::Cancelled], strict: true);
    }
}
