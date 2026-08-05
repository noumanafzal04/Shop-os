<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Register\StoreRegisterRequest;
use App\Http\Requests\Register\UpdateRegisterRequest;
use App\Models\CashSession;
use App\Models\HardwareDevice;
use App\Models\Register;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\PlanLimits;
use App\Support\RegisterContext;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Registers = the shop's checkout lanes. Two audiences:
 *   - the OWNER/MANAGER configures them (settings.manage): add lane, retire lane
 *   - the CASHIER picks one at the start of a shift (sales.manage) and asks the
 *     terminal endpoint what hardware this lane should drive.
 */
class PosRegisterController extends Controller
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchContext $branch,
        private readonly RegisterContext $terminal,
    ) {
    }

    // ── Manager: configure the lanes ────────────────────────────────

    public function index(): JsonResponse
    {
        $registers = Register::query()
            ->with('branch:id,name')
            ->orderBy('name')
            ->get();

        return ApiResponse::ok($this->decorate($registers));
    }

    public function store(StoreRegisterRequest $request): JsonResponse
    {
        $tenant = $this->tenant->get();
        if ($tenant !== null) {
            PlanLimits::assert($tenant, 'registers');
        }

        $data = $request->validated();
        $register = Register::query()->create([
            ...$data,
            // Default to the branch being operated, so a single-site shop never
            // has to think about branches at all.
            'branch_id' => $data['branch_id'] ?? $this->branch->id(),
        ]);

        return ApiResponse::created($register->fresh(), 'Register added');
    }

    public function update(UpdateRegisterRequest $request, string $id): JsonResponse
    {
        $register = Register::query()->findOrFail($id);

        // Deactivating a lane someone is standing at would strand their drawer.
        if ($request->has('is_active') && ! $request->boolean('is_active') && $register->openSession() !== null) {
            throw DomainException::conflict(
                'This register has an open shift. Close the shift before deactivating it.',
                'REGISTER_IN_USE',
            );
        }

        $register->fill($request->validated())->save();

        return ApiResponse::ok($register->fresh(), 'Register updated');
    }

    public function destroy(string $id): JsonResponse
    {
        $register = Register::query()->findOrFail($id);

        if ($register->openSession() !== null) {
            throw DomainException::conflict(
                'This register has an open shift. Close the shift before removing it.',
                'REGISTER_IN_USE',
            );
        }

        // Hardware bound to a retired lane goes back to the shared pool rather
        // than disappearing with it — the printer is still on the counter.
        HardwareDevice::query()->where('register_id', $register->id)->update(['register_id' => null]);

        $register->delete();

        return ApiResponse::noContent('Register removed');
    }

    // ── Cashier: pick a lane, know your hardware ────────────────────

    /**
     * The lane picker: every active register at this branch with its live
     * status, so a cashier can see at a glance which lanes are free.
     */
    public function lanes(): JsonResponse
    {
        $branchId = $this->branch->id();

        $registers = Register::query()
            ->with('branch:id,name')
            ->where('is_active', true)
            ->when($branchId !== null, fn ($q) => $q->where(fn ($w) => $w->where('branch_id', $branchId)->orWhereNull('branch_id')))
            ->orderBy('name')
            ->get();

        return ApiResponse::ok($this->decorate($registers));
    }

    /**
     * What this terminal is: the resolved lane, the hardware it should drive
     * (lane-bound first, shop-wide as fallback) and the shift running on it.
     */
    public function terminal(Request $request): JsonResponse
    {
        $register = $this->terminal->get();

        $session = CashSession::query()
            ->where('user_id', $request->user()->id)
            ->where('status', 'open')
            ->first();

        return ApiResponse::ok([
            'register' => $register?->load('branch:id,name'),
            'branch' => $this->branch->get(),
            'session' => $session,
            // Keyed by device type: receipt_printer, cash_drawer, …
            'devices' => HardwareDevice::resolveForRegister($register?->id),
        ]);
    }

    /**
     * Attach the live shift (who is on the lane, since when) to each register.
     * One query for all lanes — a mart's lane list must not fan out.
     *
     * @param  \Illuminate\Support\Collection<int, Register>  $registers
     * @return array<int, array<string, mixed>>
     */
    private function decorate($registers): array
    {
        $sessions = CashSession::query()
            ->with('user:id,name')
            ->whereIn('register_id', $registers->pluck('id'))
            ->where('status', 'open')
            ->get()
            ->keyBy('register_id');

        return $registers->map(function (Register $r) use ($sessions): array {
            $session = $sessions->get($r->id);

            return [
                ...$r->toArray(),
                'label' => $r->label(),
                'is_busy' => $session !== null,
                'open_session' => $session === null ? null : [
                    'id' => $session->id,
                    'user_id' => $session->user_id,
                    'user_name' => $session->user?->name,
                    'opened_at' => $session->opened_at,
                    'opening_float' => $session->opening_float,
                ],
            ];
        })->all();
    }
}
