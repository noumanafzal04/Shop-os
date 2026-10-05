<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class AuditLog extends Model
{
    use HasUuids;

    public const UPDATED_AT = null; // append-only

    /**
     * The thing this row is about, whatever kind it is.
     *
     * `withTrashed` because half the point of a trail is the rows whose subject
     * is gone: "who deleted this and what was it called" is unanswerable if the
     * relation quietly resolves to null the moment somebody deletes it.
     *
     * Null for a row about a KIND rather than a record — an import touches three
     * hundred products and belongs to none of them.
     */
    public function auditable(): MorphTo
    {
        return $this->morphTo()->withTrashed();
    }

    /**
     * What to call the subject on screen.
     *
     * The trail rendered a KIND and never a name: "Item price · 180 → 210",
     * about which of four thousand items nobody could say. A row that cannot
     * name its subject is a row nobody can act on, and this shop has been here
     * before — the whole trail was once readable only by the platform and not
     * by the business it was about.
     *
     * Each model is asked for the field a person would recognise it by, in
     * order; a model with none of them keeps its id, which is at least honest.
     */
    public function subjectName(): ?string
    {
        $subject = $this->auditable;
        if ($subject === null) {
            return null;
        }

        foreach (['name', 'business_name', 'reference', 'code', 'title'] as $field) {
            $value = $subject->getAttribute($field);
            if (is_string($value) && $value !== '') {
                return $value;
            }
        }

        return null;
    }

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'old_values' => 'array',
            'new_values' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Rows about ONE kind of record, named the way the screens name it.
     *
     * Both trails filtered with `LIKE %Customer%`, and "Customer" is also the
     * first eight letters of CustomerGroup. So "Credit limits" on the shop's
     * Activity screen — which asks for Customer — came back with every change
     * to a customer GROUP mixed into it. A filter that returns more than it
     * was asked for reads as a trail with entries nobody made, and the next
     * model named with another one's prefix would have done it again.
     *
     * Exact, on the class the row was written with. A basename is what the
     * screens send and what `entity` hands back, so that is what is accepted;
     * a full class name works too, for a caller that has one.
     */
    public function scopeAbout(Builder $query, string $type): Builder
    {
        return $query->whereIn('auditable_type', [$type, 'App\\Models\\'.class_basename($type)]);
    }
}
