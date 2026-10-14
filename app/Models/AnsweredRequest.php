<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Prunable;

/**
 * The first answer to a money form, kept against the person and the key their
 * screen minted for it. See App\Http\Middleware\AnswerOnce.
 */
class AnsweredRequest extends Model
{
    use Prunable;

    protected $guarded = ['id'];

    /** A double-click is seconds; a retry after a dropped line, minutes. Two days is plenty. */
    public function prunable(): Builder
    {
        return static::query()->where('created_at', '<', now()->subDays(2));
    }
}
