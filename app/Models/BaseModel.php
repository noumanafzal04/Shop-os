<?php

namespace App\Models;

use App\Models\Concerns\HasAuditFields;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Base for all domain models: UUID primary key, soft deletes, audit fields.
 */
abstract class BaseModel extends Model
{
    use HasAuditFields;
    use HasUuids;
    use SoftDeletes;

    protected $guarded = ['id'];
}
