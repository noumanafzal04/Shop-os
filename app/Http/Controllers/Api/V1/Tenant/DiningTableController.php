<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Restaurant\StoreDiningTableRequest;
use App\Http\Requests\Restaurant\UpdateDiningTableRequest;
use App\Models\DiningTable;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

/**
 * The restaurant floor: tables a waiter seats guests at. Occupancy is derived
 * from the open tab attached to each table (see DiningTable::openTicket).
 */
class DiningTableController extends Controller
{
    private const OPEN_TICKET = 'openTicket:id,dining_table_id,ticket_number,opened_at,guest_count,status';

    public function index(Request $request)
    {
        $tables = DiningTable::query()
            ->when($request->boolean('active_only'), fn ($q) => $q->where('is_active', true))
            ->with([self::OPEN_TICKET])
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get();

        return ApiResponse::ok($tables);
    }

    public function store(StoreDiningTableRequest $request)
    {
        $table = DiningTable::query()->create($request->validated());

        return ApiResponse::created($table, 'Table added.');
    }

    public function show(DiningTable $table)
    {
        return ApiResponse::ok($table->load([self::OPEN_TICKET]));
    }

    public function update(UpdateDiningTableRequest $request, DiningTable $table)
    {
        $table->fill($request->validated())->save();

        return ApiResponse::ok($table, 'Table updated.');
    }

    public function destroy(DiningTable $table)
    {
        if ($table->isOccupied()) {
            throw DomainException::conflict(
                "Table {$table->name} has an open tab — settle or cancel it before removing the table.",
                'TABLE_OCCUPIED',
            );
        }

        $table->delete();

        return ApiResponse::noContent('Table removed.');
    }

    /**
     * Persist a drag-reorder of the floor (array of table ids in display order).
     */
    public function reorder(Request $request)
    {
        $ids = $request->input('order', []);

        foreach (array_values($ids) as $index => $id) {
            DiningTable::query()->whereKey($id)->update(['sort_order' => $index]);
        }

        return ApiResponse::ok(null, 'Floor reordered.');
    }
}
