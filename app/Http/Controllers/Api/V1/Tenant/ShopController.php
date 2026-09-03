<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Shop\CompleteShopSetupAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Shop\CompleteSetupRequest;
use App\Http\Requests\Shop\UpdateShopRequest;
use App\Http\Requests\Shop\UpdateShopSettingsRequest;
use App\Http\Requests\Shop\UploadLogoRequest;
use App\Http\Resources\TenantResource;
use App\Support\ApiResponse;
use App\Support\Modules;
use App\Support\PlanLimits;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;

class ShopController extends Controller
{
    public function __construct(private readonly TenantContext $context) {}

    /**
     * The authenticated user's shop profile.
     */
    public function show(): JsonResponse
    {
        return ApiResponse::ok(new TenantResource($this->context->get()->load('city', 'plan')));
    }

    /**
     * Complete (or redo) onboarding.
     */
    public function setup(CompleteSetupRequest $request, CompleteShopSetupAction $action): JsonResponse
    {
        $tenant = $action->execute($this->context->get(), $request->validated());

        return ApiResponse::ok(new TenantResource($tenant), 'Shop setup completed');
    }

    /**
     * Ongoing settings edit — updates profile fields without touching
     * business-type templates or the setup_completed flag.
     */
    public function update(UpdateShopRequest $request): JsonResponse
    {
        $tenant = $this->context->get();
        $tenant->fill($request->validated())->save();

        return ApiResponse::ok(new TenantResource($tenant->load('city', 'plan')), 'Settings saved');
    }

    /** Effective shop settings (defaults merged with saved overrides). */
    public function settings(): JsonResponse
    {
        $tenant = $this->context->get();

        // Effective branch ceiling drives whether the owner sees branch UI
        // (single-branch tenants never do). null = unlimited.
        return ApiResponse::ok($tenant->allSettings() + [
            'max_branches' => PlanLimits::limit($tenant, 'branches'),
        ]);
    }

    /**
     * What this shop has, and what it has not.
     *
     * The registry with each module's state on it — one answer, from the one
     * place the gate reads, so the screen can never describe a shop the server
     * does not agree with.
     *
     * Read-only on purpose. Modules are the admin's decision: a shop able to
     * switch its own POS off would be a support call, and one able to switch
     * `inventory` off would silently strand every stock figure it had. What was
     * missing was not control — it was the ANSWER. "Why can I not see
     * Purchases" had nowhere to look, and a screen that has vanished with no
     * explanation reads as a broken product.
     */
    public function modules(): JsonResponse
    {
        $tenant = $this->context->get();

        return ApiResponse::ok(
            collect(Modules::catalog())
                ->map(fn (array $m): array => $m + [
                    // The gate's own answer, not the stored flag: a module
                    // standing on one that is off is not enabled, however the
                    // map was written.
                    'enabled' => $tenant->featureEnabled($m['key']),
                ])
                ->values()
                ->all(),
        );
    }

    /** Persist a partial settings update (merged over what's stored). */
    public function updateSettings(UpdateShopSettingsRequest $request): JsonResponse
    {
        $tenant = $this->context->get();
        $merged = array_merge($tenant->settings ?? [], $request->validated());

        // A shop must be orderable SOMEHOW: pickup and delivery can't both be off.
        $pickupOn = (bool) ($merged['pickup_enabled'] ?? true);
        $deliveryOn = (bool) ($merged['delivery_enabled'] ?? true) && $tenant->featureEnabled('delivery');
        if (! $pickupOn && ! $deliveryOn) {
            throw DomainException::unprocessable(
                'Enable at least one fulfillment option — pickup or delivery.',
                'FULFILLMENT_REQUIRED',
            );
        }

        $tenant->forceFill(['settings' => $merged])->save();

        return ApiResponse::ok($tenant->allSettings(), 'Settings saved');
    }

    /**
     * Logo upload — separate multipart endpoint; old logo replaced.
     */
    public function uploadLogo(UploadLogoRequest $request): JsonResponse
    {
        $tenant = $this->context->get();

        if ($tenant->logo_path) {
            Storage::disk('public')->delete($tenant->logo_path);
        }

        $path = $request->file('logo')->store("logos/{$tenant->id}", 'public');

        $tenant->forceFill(['logo_path' => $path])->save();

        return ApiResponse::ok(new TenantResource($tenant->load('city', 'plan')), 'Logo updated');
    }
}
