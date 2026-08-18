<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Fuel\StoreFuelNozzleRequest;
use App\Http\Requests\Fuel\StoreFuelPumpRequest;
use App\Http\Requests\Fuel\StoreFuelTankRequest;
use App\Models\Branch;
use App\Models\ForecourtShift;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelTank;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * The physical plant: tanks, pumps, the hoses on them.
 *
 * Set up once and then left alone. Everything here is deliberately hard to
 * remove while a shift is open — a nozzle deleted mid-shift takes its opening
 * reading out of the reconciliation with it, and the tank it fed then shows the
 * missing litres as a loss.
 */
class FuelSetupController extends Controller
{
    /**
     * Give a piece of plant the branch it stands at, when the client named none.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function atABranch(array $data): array
    {
        if (empty($data['branch_id'])) {
            $data['branch_id'] = Branch::writeTargetId();
        }

        return $data;
    }

    // ── Tanks ───────────────────────────────────────────────────────

    public function tanks(): JsonResponse
    {
        $tanks = FuelTank::query()
            ->with(['product:id,name,price,unit', 'branch:id,name'])
            ->withCount('nozzles')
            ->orderBy('name')
            ->get()
            ->map(fn (FuelTank $t) => $this->presentTank($t));

        return ApiResponse::ok($tanks);
    }

    public function storeTank(StoreFuelTankRequest $request): JsonResponse
    {
        // A tank stands somewhere. `branch_id` is nullable on the request
        // because a single-site station never picks one — and the panel's own
        // form does not send it — but storing that null made the tank invisible
        // to the shift, which resolves a missing branch to Main. The two halves
        // answered the same question in opposite directions, so a station that
        // set its forecourt up through the panel could never open a shift.
        $tank = FuelTank::query()->create($this->atABranch($request->validated()));

        return ApiResponse::created($this->presentTank($tank->load(['product:id,name,price,unit', 'branch:id,name'])), 'Tank added');
    }

    public function updateTank(StoreFuelTankRequest $request, string $id): JsonResponse
    {
        /** @var FuelTank $tank */
        $tank = FuelTank::query()->findOrFail($id);

        // The dip is a measurement, and after the first one it belongs to the
        // shift close. Letting it be typed here would absorb a variance without
        // anyone recording that it happened.
        $data = $request->validated();
        if ($this->hasOpenShift($tank->branch_id)) {
            unset($data['current_dip_litres']);
        }

        $tank->update($data);

        return ApiResponse::ok($this->presentTank($tank->load(['product:id,name,price,unit', 'branch:id,name'])), 'Tank updated');
    }

    public function destroyTank(string $id): JsonResponse
    {
        /** @var FuelTank $tank */
        $tank = FuelTank::query()->findOrFail($id);

        $this->assertNoOpenShift($tank->branch_id, 'tank');

        $tank->delete();

        return ApiResponse::noContent('Tank removed');
    }

    // ── Pumps + nozzles ─────────────────────────────────────────────

    public function pumps(): JsonResponse
    {
        $pumps = FuelPump::query()
            ->with(['branch:id,name', 'nozzles' => fn ($q) => $q->orderBy('name')->with('tank:id,name,product_id')])
            ->orderBy('name')
            ->get();

        return ApiResponse::ok($pumps);
    }

    public function storePump(StoreFuelPumpRequest $request): JsonResponse
    {
        // Same reason as the tank above: physical plant belongs to a site.
        $pump = FuelPump::query()->create($this->atABranch($request->validated()));

        return ApiResponse::created($pump->load('branch:id,name'), 'Pump added');
    }

    public function updatePump(StoreFuelPumpRequest $request, string $id): JsonResponse
    {
        /** @var FuelPump $pump */
        $pump = FuelPump::query()->findOrFail($id);
        $pump->update($request->validated());

        return ApiResponse::ok($pump->load('branch:id,name'), 'Pump updated');
    }

    public function destroyPump(string $id): JsonResponse
    {
        /** @var FuelPump $pump */
        $pump = FuelPump::query()->findOrFail($id);

        $this->assertNoOpenShift($pump->branch_id, 'pump');

        $pump->nozzles()->delete();
        $pump->delete();

        return ApiResponse::noContent('Pump removed');
    }

    public function storeNozzle(StoreFuelNozzleRequest $request, string $pumpId): JsonResponse
    {
        /** @var FuelPump $pump */
        $pump = FuelPump::query()->findOrFail($pumpId);

        $nozzle = FuelNozzle::query()->create($request->validated() + ['fuel_pump_id' => $pump->id]);

        return ApiResponse::created($nozzle->load('tank:id,name,product_id'), 'Nozzle added');
    }

    public function updateNozzle(StoreFuelNozzleRequest $request, string $pumpId, string $id): JsonResponse
    {
        /** @var FuelNozzle $nozzle */
        $nozzle = FuelNozzle::query()->where('fuel_pump_id', $pumpId)->findOrFail($id);

        $data = $request->validated();

        // A totaliser cannot be wound back, and a shift already holds this
        // nozzle's opening number. Both are silent corruptions if allowed.
        if (array_key_exists('current_reading', $data)) {
            if ($this->hasOpenShift($nozzle->pump?->branch_id)) {
                unset($data['current_reading']);
            } elseif ((float) $data['current_reading'] < (float) $nozzle->current_reading) {
                throw DomainException::unprocessable(
                    "A meter only counts up — {$nozzle->name} is already at {$nozzle->current_reading}.",
                    'READING_WENT_BACKWARDS',
                );
            }
        }

        $nozzle->update($data);

        return ApiResponse::ok($nozzle->load('tank:id,name,product_id'), 'Nozzle updated');
    }

    public function destroyNozzle(string $pumpId, string $id): JsonResponse
    {
        /** @var FuelNozzle $nozzle */
        $nozzle = FuelNozzle::query()->where('fuel_pump_id', $pumpId)->findOrFail($id);

        $this->assertNoOpenShift($nozzle->pump?->branch_id, 'nozzle');

        $nozzle->delete();

        return ApiResponse::noContent('Nozzle removed');
    }

    private function hasOpenShift(?string $branchId): bool
    {
        return ForecourtShift::query()
            ->where('status', ForecourtShift::STATUS_OPEN)
            ->where('branch_id', $branchId)
            ->exists();
    }

    private function assertNoOpenShift(?string $branchId, string $what): void
    {
        if ($this->hasOpenShift($branchId)) {
            throw DomainException::conflict(
                "Close the open forecourt shift before removing a {$what} — it holds this shift's opening readings.",
                'FORECOURT_SHIFT_OPEN',
            );
        }
    }

    /** @return array<string, mixed> */
    private function presentTank(FuelTank $tank): array
    {
        return $tank->toArray() + [
            // Two numbers a forecourt manager reads before ordering: what can
            // actually be sold, and whether a full tanker would even fit.
            'sellable_litres' => $tank->sellableLitres(),
            'ullage_litres' => $tank->ullageLitres(),
        ];
    }
}
