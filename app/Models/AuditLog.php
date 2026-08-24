<?php

namespace App\Models;

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
}
