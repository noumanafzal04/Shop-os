<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SubscriptionPayment extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'period_start' => 'date',
            'period_end' => 'date',
            'paid_at' => 'datetime',
        ];
    }

    /**
     * `withTrashed`, because a closed shop still paid these invoices.
     *
     * Tenant soft-deletes (BaseModel applies SoftDeletes), and DeleteTenantAction
     * promises in as many words that "reports, invoices and history survive for
     * auditing". They survived — anonymously. The default `belongsTo` carries the
     * soft-delete scope, so the moment a shop was closed every payment it had
     * ever made rendered with a BLANK name in the platform's ledger: the rows
     * were all still there, and nothing on them said whose they were.
     *
     * That is the worst version of keeping a record. A ledger you cannot read is
     * not an audit trail, and the one time anybody goes looking is after the
     * shop is gone.
     */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class)->withTrashed();
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }
}
