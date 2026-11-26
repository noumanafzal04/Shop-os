<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A problem a customer reported with an order, and the platform's answer.
 * Not tenant-scoped: the platform reads every shop's, and the shop and the
 * customer each read their own through the order.
 */
class OrderIssue extends Model
{
    use HasUuids;

    public const KINDS = [
        'missing_item' => 'Something was missing',
        'wrong_item' => 'Wrong item',
        'late' => 'Arrived very late',
        'quality' => 'Food or item quality',
        'rider' => 'Problem with the rider',
        'payment' => 'Charged wrongly',
        'other' => 'Something else',
    ];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'resolved_at' => 'datetime',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    /** What the customer reads on their order. */
    public function forCustomer(): array
    {
        return [
            'id' => $this->id,
            'kind' => $this->kind,
            'kind_label' => self::KINDS[$this->kind] ?? $this->kind,
            'note' => $this->note,
            'status' => $this->status,
            'outcome' => $this->outcome,
            'amount' => $this->amount,
            'voucher_code' => $this->voucher_code,
            'answer' => $this->answer,
            'reported_at' => $this->created_at?->toIso8601String(),
            'resolved_at' => $this->resolved_at?->toIso8601String(),
        ];
    }
}
