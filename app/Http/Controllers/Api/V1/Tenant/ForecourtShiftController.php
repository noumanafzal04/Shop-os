<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Fuel\CloseForecourtShiftAction;
use App\Actions\Fuel\OpenForecourtShiftAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Fuel\CloseForecourtShiftRequest;
use App\Http\Requests\Fuel\OpenForecourtShiftRequest;
use App\Models\ForecourtShift;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The forecourt shift: open on a full set of readings, close on the
 * reconciliation.
 *
 * Deliberately not the cashier's cash_session. That one is one person at one
 * drawer; this is the whole forecourt between two sets of meter readings, and
 * three cashiers come and go inside one of them on a busy pump.
 */
class ForecourtShiftController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $shifts = ForecourtShift::query()
            ->with(['branch:id,name', 'openedBy:id,name', 'closedBy:id,name'])
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->string('branch_id')))
            ->when($request->filled('from'), fn ($q) => $q->whereDate('opened_at', '>=', $request->date('from')))
            ->when($request->filled('to'), fn ($q) => $q->whereDate('opened_at', '<=', $request->date('to')))
            ->orderByDesc('opened_at')
            ->paginate(20);

        return ApiResponse::paginated($shifts);
    }

    /**
     * The shift the forecourt is running right now, with live readings — this
     * is what the close screen loads to show the attendant what to walk out and
     * read.
     */
    public function current(Request $request): JsonResponse
    {
        /**
         * THE RUNNING SHIFT WAS POORER THAN THE CLOSED ONE.
         *
         * This loaded `readings` and `dips` and nothing else, so the screen an
         * operator actually works on — the one where they read every meter at
         * the end of a shift — could not show two things it is built around:
         *
         *  ATTENDANTS  naming who is on which hose is the ONLY question the
         *              start-shift screen asks, and the whole reason it asks
         *              is to turn "forty litres unbilled" into "forty litres
         *              on Ali's nozzles". That name was then invisible for the
         *              entire shift and only appeared after closing.
         *  DELIVERIES  a tanker that discharged mid-shift changes the dip
         *              arithmetic — `book = opening + delivered − meter`. An
         *              operator who cannot see the delivery cannot tell a
         *              correct variance from a wrong one.
         *
         * `show()` has loaded both since the beginning. The two endpoints
         * answered the same question at different depths, and the shallower
         * one was the one people use.
         */
        $shift = ForecourtShift::query()
            ->where('status', ForecourtShift::STATUS_OPEN)
            ->when($request->filled('branch_id'), fn ($q) => $q->where('branch_id', $request->string('branch_id')))
            ->with(['readings.attendant:id,name', 'dips', 'deliveries', 'openedBy:id,name'])
            ->orderByDesc('opened_at')
            ->first();

        return ApiResponse::ok($shift === null ? null : $this->present($shift));
    }

    public function store(OpenForecourtShiftRequest $request, OpenForecourtShiftAction $action): JsonResponse
    {
        $shift = $action->execute($request->user(), $request->validated());

        return ApiResponse::created($shift->load(['readings', 'dips']), "Forecourt shift {$shift->number} opened");
    }

    public function show(string $id): JsonResponse
    {
        $shift = ForecourtShift::query()
            ->with([
                'readings.attendant:id,name', 'dips', 'deliveries.supplier:id,name',
                'branch:id,name', 'openedBy:id,name', 'closedBy:id,name',
            ])
            ->findOrFail($id);

        return ApiResponse::ok($this->present($shift));
    }

    public function close(CloseForecourtShiftRequest $request, string $id, CloseForecourtShiftAction $action): JsonResponse
    {
        /** @var ForecourtShift $shift */
        $shift = ForecourtShift::query()->findOrFail($id);

        $closed = $action->execute($request->user(), $shift, $request->validated());

        return ApiResponse::ok(
            $this->present($closed->load(['readings.attendant:id,name', 'dips'])),
            "Forecourt shift {$closed->number} closed",
        );
    }

    /**
     * The shift, plus what each attendant is responsible for.
     *
     * The handover figure, straight off the meters. It deliberately does not
     * split the unbilled litres — a till sale does not record which nozzle it
     * came from, so that gap is a station figure and dividing it by attendant
     * would be inventing an accusation. See `ForecourtShift::attendantTotals`.
     */
    private function present(ForecourtShift $shift): array
    {
        return array_merge($shift->toArray(), [
            'attendant_totals' => $shift->attendantTotals(),
        ]);
    }
}
