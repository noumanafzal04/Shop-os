<?php

use App\Http\Controllers\Api\V1\Admin\AuditLogController;
use App\Http\Controllers\Api\V1\Admin\BillingController;
use App\Http\Controllers\Api\V1\Admin\DashboardController as AdminDashboardController;
use App\Http\Controllers\Api\V1\Admin\PlanController;
use App\Http\Controllers\Api\V1\Admin\StaffController as AdminStaffController;
use App\Http\Controllers\Api\V1\Admin\AnnouncementController;
use App\Http\Controllers\Api\V1\Admin\BannerController as AdminBannerController;
use App\Http\Controllers\Api\V1\Admin\TenantController;
use App\Http\Controllers\Api\V1\BusinessTypeController;
use App\Http\Controllers\Api\V1\Tenant\CategoryController;
use App\Http\Controllers\Api\V1\Tenant\CollectionController;
use App\Http\Controllers\Api\V1\Tenant\CouponController;
use App\Http\Controllers\Api\V1\Tenant\GalleryController;
use App\Http\Controllers\Api\V1\Tenant\CustomerController;
use App\Http\Controllers\Api\V1\Tenant\DashboardController;
use App\Http\Controllers\Api\V1\Tenant\DiningTableController;
use App\Http\Controllers\Api\V1\Tenant\RestaurantTicketController;
use App\Http\Controllers\Api\V1\Tenant\ExpenseCategoryController;
use App\Http\Controllers\Api\V1\Tenant\ExpenseController;
use App\Http\Controllers\Api\V1\Tenant\IncomeCategoryController;
use App\Http\Controllers\Api\V1\Tenant\IncomeController;
use App\Http\Controllers\Api\V1\Tenant\BatchController;
use App\Http\Controllers\Api\V1\Tenant\InventoryController;
use App\Http\Controllers\Api\V1\Tenant\OrderController;
use App\Http\Controllers\Api\V1\Tenant\ReportController;
use App\Http\Controllers\Api\V1\Tenant\ProductController;
use App\Http\Controllers\Api\V1\Tenant\PosController;
use App\Http\Controllers\Api\V1\Tenant\ProductImageController;
use App\Http\Controllers\Api\V1\Tenant\PurchaseOrderController;
use App\Http\Controllers\Api\V1\Tenant\RiderController;
use App\Http\Controllers\Api\V1\Tenant\SupplierController;
use App\Http\Controllers\Api\V1\Tenant\SupplierPaymentController;
use App\Http\Controllers\Api\V1\Tenant\SaleController;
use App\Http\Controllers\Api\V1\Tenant\ShopController;
use App\Http\Controllers\Api\V1\Tenant\StaffController as TenantStaffController;
use App\Http\Controllers\Api\V1\Auth\AuthController;
use App\Http\Controllers\Api\V1\Auth\OtpController;
use App\Http\Controllers\Api\V1\Auth\RegisterController;
use App\Http\Controllers\Api\V1\Customer\AddressController as CustomerAddressController;
use App\Http\Controllers\Api\V1\Marketplace\CustomerOrderController;
use App\Http\Controllers\Api\V1\Marketplace\CustomerReservationController;
use App\Http\Controllers\Api\V1\Marketplace\FavoriteController;
use App\Http\Controllers\Api\V1\Marketplace\BannerController as PublicBannerController;
use App\Http\Controllers\Api\V1\Marketplace\MarketplaceController;
use App\Http\Controllers\Api\V1\Marketplace\ReviewController;
use App\Http\Controllers\Api\V1\Tenant\ReservationController;
use App\Http\Controllers\Api\V1\Tenant\TenantReviewController;
use App\Http\Controllers\Api\V1\Auth\PasswordController;
use App\Http\Controllers\Api\V1\Auth\SessionController;
use App\Http\Controllers\Api\V1\CityController;
use App\Http\Controllers\Api\V1\DeviceController;
use App\Http\Controllers\Api\V1\NotificationController;
use App\Support\ApiResponse;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API v1
|--------------------------------------------------------------------------
| All endpoints live under /api/v1 and return the standard envelope.
| Route groups per module are registered here as each step lands.
*/

Route::prefix('v1')->middleware('throttle:api')->group(function (): void {

    Route::get('/health', function () {
        return ApiResponse::ok([
            'app' => config('app.name'),
            'version' => 'v1',
            'time' => now()->toIso8601String(),
        ], 'Service healthy');
    });

    // ── Auth (public) ────────────────────────────────────────────────
    Route::prefix('auth')->group(function (): void {
        Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:auth');
        Route::post('/otp/request', [OtpController::class, 'request'])->middleware('throttle:otp');
        Route::post('/otp/login', [AuthController::class, 'otpLogin'])->middleware('throttle:auth');
        Route::post('/password/reset', [PasswordController::class, 'reset'])->middleware('throttle:auth');

        // Refresh authenticates with the refresh token itself (not 'access').
        Route::post('/refresh', [AuthController::class, 'refresh'])->middleware('auth:sanctum');
    });

    // ── Public lookups ───────────────────────────────────────────────
    Route::get('/cities', [CityController::class, 'index']);
    Route::get('/business-types', [BusinessTypeController::class, 'index']);
    Route::get('/item-types', [BusinessTypeController::class, 'itemTypes']);

    // ── Public marketplace (Online-Shop tenants only) ────────────────
    Route::prefix('marketplace')->group(function (): void {
        // GPS → nearest city (no manual city picker on mobile)
        Route::get('/locate', [MarketplaceController::class, 'locate']);
        // Universal search (products + shops + categories, one box)
        Route::get('/search', [MarketplaceController::class, 'search']);
        // Mobile home screen in one round trip
        Route::get('/home', [MarketplaceController::class, 'home']);
        Route::get('/shops', [MarketplaceController::class, 'shops']);
        Route::get('/shops/{slug}', [MarketplaceController::class, 'shop']);
        Route::get('/shops/{slug}/products', [MarketplaceController::class, 'products']);
        Route::get('/shops/{slug}/reviews', [ReviewController::class, 'index']);
        // Promo banners for the home screen (mobile + web)
        Route::get('/banners', [PublicBannerController::class, 'index']);
        Route::post('/banners/{id}/click', [PublicBannerController::class, 'click']);
    });

    // Customer self-registration (business accounts are admin-created only)
    Route::post('/auth/register', [RegisterController::class, 'store'])->middleware('throttle:auth');

    // ── Authenticated (access tokens only) ──────────────────────────
    Route::middleware(['auth:sanctum', 'abilities:access', 'tenant'])->group(function (): void {
        Route::prefix('auth')->group(function (): void {
            Route::get('/me', [AuthController::class, 'me']);
            Route::post('/password/change', [AuthController::class, 'changePassword']);
            Route::post('/logout', [AuthController::class, 'logout']);
            Route::post('/logout-all', [AuthController::class, 'logoutAll']);
            Route::get('/sessions', [SessionController::class, 'index']);
            Route::delete('/sessions/{tokenId}', [SessionController::class, 'destroy']);
        });

        // ── Tenant side: shop profile, setup, dashboard ──────────────
        // 'subscription': read-only mode blocks writes after grace expiry.
        Route::middleware(['role:shop_owner,staff', 'subscription'])->group(function (): void {
            Route::get('/dashboard', [DashboardController::class, 'index']);
            Route::get('/shop', [ShopController::class, 'show']);
            Route::put('/shop/setup', [ShopController::class, 'setup'])->middleware('permission:settings.manage');
            Route::put('/shop', [ShopController::class, 'update'])->middleware('permission:settings.manage');
            Route::get('/shop/settings', [ShopController::class, 'settings']);
            Route::get('/shop/subscription', [\App\Http\Controllers\Api\V1\Tenant\SubscriptionController::class, 'show']);
            Route::put('/shop/settings', [ShopController::class, 'updateSettings'])->middleware('permission:settings.manage');
            // Portfolio / gallery (service businesses)
            Route::get('/shop/gallery', [GalleryController::class, 'index']);
            Route::post('/shop/gallery', [GalleryController::class, 'store']);
            Route::delete('/shop/gallery/{image}', [GalleryController::class, 'destroy']);
            Route::post('/shop/logo', [ShopController::class, 'uploadLogo'])->middleware('permission:settings.manage');

            // Catalog: categories + collections + items (products & services)
            Route::middleware('permission:products.manage')->group(function (): void {
                Route::post('categories/reorder', [CategoryController::class, 'reorder']);
                Route::apiResource('categories', CategoryController::class);
                Route::apiResource('collections', CollectionController::class);
                // Bulk CSV import (before the resource so /products/import isn't
                // captured by /products/{product}).
                Route::get('products/import/template', [ProductController::class, 'importTemplate']);
                Route::post('products/import', [ProductController::class, 'import']);
                Route::apiResource('products', ProductController::class);
                // Product images — multipart upload / delete
                Route::post('products/{product}/images', [ProductImageController::class, 'store']);
                Route::delete('products/{product}/images/{image}', [ProductImageController::class, 'destroy']);
                Route::post('products/{product}/barcode', [ProductController::class, 'generateBarcode']);
                Route::put('products/{product}/modifier-groups', [ProductController::class, 'syncModifiers']);
            });

            // Customers — CRM directory (auto-captured from sales/orders)
            Route::middleware('permission:customers.manage')->group(function (): void {
                // Khata repayment — pay down a customer's credit balance.
                Route::post('customers/{customer}/payments', [CustomerController::class, 'recordPayment']);
                Route::apiResource('customers', CustomerController::class);
            });

            // Coupons — discount codes for POS + checkout
            Route::middleware('permission:coupons.manage')->group(function (): void {
                Route::post('coupons/validate', [CouponController::class, 'validateCode']);
                Route::apiResource('coupons', CouponController::class);
            });

            // Suppliers — vendor directory + payables
            Route::middleware('permission:suppliers.manage')->group(function (): void {
                Route::apiResource('suppliers', SupplierController::class);
            });

            // Purchases: Supplier → PO → Receive → Inventory
            Route::middleware('permission:purchases.manage')->group(function (): void {
                Route::apiResource('purchase-orders', PurchaseOrderController::class)
                    ->only(['index', 'store', 'show']);
                Route::post('purchase-orders/{purchaseOrder}/place', [PurchaseOrderController::class, 'place']);
                Route::post('purchase-orders/{purchaseOrder}/receive', [PurchaseOrderController::class, 'receive']);
                Route::post('purchase-orders/{purchaseOrder}/cancel', [PurchaseOrderController::class, 'cancel']);
                Route::post('suppliers/{supplier}/payments', [SupplierPaymentController::class, 'store']);
            });

            // POS terminal: scan, shifts, held sales (checkout goes through /sales).
            // Gated by the POS module — an online-only shop has no in-shop till.
            Route::prefix('pos')->middleware(['feature:pos', 'permission:sales.manage'])->group(function (): void {
                Route::get('/lookup', [PosController::class, 'lookup']);
                Route::get('/session', [PosController::class, 'currentSession']);
                Route::post('/session/open', [PosController::class, 'openSession']);
                Route::post('/session/close', [PosController::class, 'closeSession']);
                Route::get('/held', [PosController::class, 'heldIndex']);
                Route::post('/held', [PosController::class, 'heldStore']);
                Route::delete('/held/{id}', [PosController::class, 'heldDestroy']);
            });

            // Sales: workflow → payment → invoice → stock decrement
            Route::prefix('sales')->middleware('permission:sales.manage')->group(function (): void {
                Route::get('/', [SaleController::class, 'index']);
                // Ringing up a counter sale needs the POS module; viewing and
                // refunding sales stays open (online sales appear here too).
                Route::post('/', [SaleController::class, 'store'])->middleware('feature:pos');
                Route::get('/{sale}', [SaleController::class, 'show']);
                Route::post('/{sale}/cancel', [SaleController::class, 'cancel']);
                Route::post('/{sale}/returns', [SaleController::class, 'processReturn']);
                // Exchange rings a replacement sale, so it needs the POS module.
                Route::post('/{sale}/exchange', [SaleController::class, 'exchange'])->middleware('feature:pos');
                Route::get('/{sale}/invoice', [SaleController::class, 'invoice']);
            });

            // Inventory: the single write-path for stock
            Route::prefix('inventory')->middleware('permission:inventory.manage')->group(function (): void {
                Route::post('/adjust', [InventoryController::class, 'adjust']);
                Route::get('/movements', [InventoryController::class, 'movements']);
                Route::get('/low-stock', [InventoryController::class, 'lowStock']);
                // Batch/lot + expiry tracking (pharmacy, perishables)
                Route::get('/expiring', [BatchController::class, 'expiring']);
                Route::get('/products/{product}/batches', [BatchController::class, 'index']);
                Route::post('/products/{product}/batches', [BatchController::class, 'store']);
                Route::patch('/batches/{batch}', [BatchController::class, 'update']);
                Route::delete('/batches/{batch}', [BatchController::class, 'destroy']);
            });

            // Expense categories (templates from business type, editable).
            // The Expense Manager is an admin-controlled module — a shop that
            // only sells (e.g. a food stall) can have it switched off.
            Route::middleware(['feature:expenses', 'permission:expenses.manage'])->group(function (): void {
                Route::apiResource('expense-categories', ExpenseCategoryController::class)
                    ->except(['show']);
                Route::apiResource('expenses', ExpenseController::class)->except(['show']);

                // Income is the other half of the same module.
                Route::apiResource('income-categories', IncomeCategoryController::class)
                    ->except(['show']);
                Route::apiResource('incomes', IncomeController::class)->except(['show']);

                // Cashbook: unified money-in / money-out ledger. DERIVES sales
                // revenue + refunds + expenses (never duplicates them) and adds
                // the manual income entries — a day-by-day running balance.
                Route::get('/cashbook', [ReportController::class, 'cashbook']);
            });

            // Reports
            Route::middleware('permission:reports.view')->group(function (): void {
                Route::get('/reports/summary', [ReportController::class, 'summary']);
                Route::get('/reports/purchases', [ReportController::class, 'purchases']);
                Route::get('/reports/staff', [ReportController::class, 'staff']);
                Route::get('/reports/tax', [ReportController::class, 'tax']);
            });

            // Reviews (owner side: view + reply)
            Route::get('/reviews', [TenantReviewController::class, 'index']);
            Route::get('/reviews/summary', [TenantReviewController::class, 'summary']);
            Route::post('/reviews/{id}/reply', [TenantReviewController::class, 'reply'])
                ->middleware('permission:settings.manage');

            // Online orders (owner side)
            Route::prefix('orders')->middleware('permission:orders.manage')->group(function (): void {
                Route::get('/', [OrderController::class, 'index']);
                Route::get('/{id}', [OrderController::class, 'show']);
                Route::post('/{id}/advance', [OrderController::class, 'advance']);
                Route::post('/{id}/assign-rider', [OrderController::class, 'assignRider']);
                Route::post('/{id}/cancel', [OrderController::class, 'cancel']);
            });

            // Delivery riders (Model A — the shop's own riders)
            Route::middleware('permission:orders.manage')->group(function (): void {
                Route::get('/riders', [RiderController::class, 'index']);
                Route::post('/riders', [RiderController::class, 'store']);
                Route::patch('/riders/{id}', [RiderController::class, 'update']);
                Route::delete('/riders/{id}', [RiderController::class, 'destroy']);
            });

            // Reservations (owner side)
            Route::prefix('reservations')->middleware('permission:reservations.manage')->group(function (): void {
                Route::get('/', [ReservationController::class, 'index']);
                Route::post('/{id}/accept', [ReservationController::class, 'accept']);
                Route::post('/{id}/reject', [ReservationController::class, 'reject']);
                Route::post('/{id}/complete', [ReservationController::class, 'complete']);
            });

            // Dine-in (restaurant depth): a floor of tables, running tabs,
            // kitchen tickets (KOT), and settle + split-bill. Gated by the
            // dine_in module (defaults on for restaurants only).
            Route::prefix('restaurant')->middleware('feature:dine_in')->group(function (): void {
                // Floor setup (owner / manager).
                Route::middleware('permission:settings.manage')->group(function (): void {
                    Route::post('tables/reorder', [DiningTableController::class, 'reorder']);
                    Route::apiResource('tables', DiningTableController::class);
                });

                // Floor operations (waiters / cashiers with sales.manage).
                Route::middleware('permission:sales.manage')->group(function (): void {
                    Route::get('tickets', [RestaurantTicketController::class, 'index']);
                    Route::post('tickets', [RestaurantTicketController::class, 'store']);
                    Route::get('tickets/{ticket}', [RestaurantTicketController::class, 'show']);
                    Route::post('tickets/{ticket}/items', [RestaurantTicketController::class, 'addItems']);
                    Route::delete('tickets/{ticket}/items/{item}', [RestaurantTicketController::class, 'voidItem']);
                    Route::post('tickets/{ticket}/fire', [RestaurantTicketController::class, 'fire']);
                    Route::get('tickets/{ticket}/kot/{kot}', [RestaurantTicketController::class, 'kotPrint']);
                    Route::post('tickets/{ticket}/settle', [RestaurantTicketController::class, 'settle']);
                    Route::post('tickets/{ticket}/cancel', [RestaurantTicketController::class, 'cancel']);
                });
            });
        });

        // ── Platform side (Super Admin + platform staff) ─────────────
        Route::prefix('admin')->middleware('role:super_admin,admin_staff')->group(function (): void {
            Route::get('/dashboard', [AdminDashboardController::class, 'index']);
            Route::get('/audit-logs', [AuditLogController::class, 'index'])->middleware('role:super_admin');

            // Plans — read for all platform roles, writes Super-Admin only.
            Route::get('/plans', [PlanController::class, 'index']);
            Route::post('/plans', [PlanController::class, 'store'])->middleware('role:super_admin');
            Route::put('/plans/{plan}', [PlanController::class, 'update'])->middleware('role:super_admin');
            Route::delete('/plans/{plan}', [PlanController::class, 'destroy'])->middleware('role:super_admin');

            // Billing / subscription payments
            Route::get('/billing/summary', [BillingController::class, 'summary']);
            Route::get('/billing/payments', [BillingController::class, 'payments']);

            // Platform staff management
            Route::prefix('staff')->middleware('permission:platform_staff.manage')->group(function (): void {
                Route::get('/permissions', [AdminStaffController::class, 'permissions']);
                Route::get('/', [AdminStaffController::class, 'index']);
                Route::post('/', [AdminStaffController::class, 'store']);
                Route::get('/{staff}', [AdminStaffController::class, 'show']);
                Route::put('/{staff}', [AdminStaffController::class, 'update']);
                Route::delete('/{staff}', [AdminStaffController::class, 'destroy']);
            });

            // Module catalog for the Module Management screen
            Route::get('/modules', [TenantController::class, 'moduleCatalog'])->middleware('permission:tenants.view');

            // Tenant management — permission-gated per action
            Route::prefix('tenants')->group(function (): void {
                Route::get('/', [TenantController::class, 'index'])->middleware('permission:tenants.view');
                Route::post('/', [TenantController::class, 'store'])->middleware('permission:tenants.create');
                Route::get('/{tenant}', [TenantController::class, 'show'])->middleware('permission:tenants.view');
                Route::put('/{tenant}', [TenantController::class, 'update'])->middleware('permission:tenants.update');
                Route::put('/{tenant}/modules', [TenantController::class, 'updateModules'])->middleware('permission:tenants.update');
                Route::put('/{tenant}/limits', [TenantController::class, 'extendLimits'])->middleware('permission:tenants.update');
                Route::delete('/{tenant}', [TenantController::class, 'destroy'])->middleware('permission:tenants.delete');
                Route::post('/{tenant}/suspend', [TenantController::class, 'suspend'])->middleware('permission:tenants.suspend');
                Route::post('/{tenant}/activate', [TenantController::class, 'activate'])->middleware('permission:tenants.suspend');
                Route::post('/{tenant}/restore', [TenantController::class, 'restore'])->middleware('permission:tenants.delete');
                Route::post('/{tenant}/assign-plan', [TenantController::class, 'assignPlan'])->middleware('permission:tenants.assign_plan');
            });

            // Promo banners (paid ads) — admin-created
            Route::middleware('permission:banners.manage')->group(function (): void {
                Route::get('/banners', [AdminBannerController::class, 'index']);
                Route::post('/banners', [AdminBannerController::class, 'store']);
                Route::post('/banners/{banner}', [AdminBannerController::class, 'update']); // multipart update
                Route::delete('/banners/{banner}', [AdminBannerController::class, 'destroy']);
            });

            // Announcements (FCM broadcasts) — admin-created
            Route::middleware('permission:announcements.manage')->group(function (): void {
                Route::get('/announcements', [AnnouncementController::class, 'index']);
                Route::post('/announcements', [AnnouncementController::class, 'store']);
                Route::post('/announcements/{announcement}', [AnnouncementController::class, 'update']); // multipart update
                Route::post('/announcements/{announcement}/send', [AnnouncementController::class, 'send']);
                Route::delete('/announcements/{announcement}', [AnnouncementController::class, 'destroy']);
            });
        });

        // ── Notifications (every authenticated role) ──────────────────
        Route::get('/notifications', [NotificationController::class, 'index']);
        Route::post('/notifications/read-all', [NotificationController::class, 'markAllRead']);
        Route::post('/notifications/{id}/read', [NotificationController::class, 'markRead']);

        // Push device registration (mobile) — any authenticated user
        Route::post('/devices', [DeviceController::class, 'store']);
        Route::delete('/devices', [DeviceController::class, 'destroy']);

        // ── Customer side ─────────────────────────────────────────────
        Route::prefix('customer')->middleware('role:customer')->group(function (): void {
            Route::get('/favorites', [FavoriteController::class, 'index']);
            Route::post('/favorites/{slug}', [FavoriteController::class, 'toggle']);

            // Saved delivery locations (map pin + label)
            Route::get('/addresses', [CustomerAddressController::class, 'index']);
            Route::post('/addresses', [CustomerAddressController::class, 'store']);
            Route::put('/addresses/{id}', [CustomerAddressController::class, 'update']);
            Route::delete('/addresses/{id}', [CustomerAddressController::class, 'destroy']);

            Route::get('/reservations', [CustomerReservationController::class, 'index']);
            Route::post('/reservations', [CustomerReservationController::class, 'store']);
            Route::post('/reservations/{id}/cancel', [CustomerReservationController::class, 'cancel']);

            Route::post('/reviews', [ReviewController::class, 'store']);
            Route::delete('/reviews/{id}', [ReviewController::class, 'destroy']);

            Route::get('/orders', [CustomerOrderController::class, 'index']);
            Route::post('/orders', [CustomerOrderController::class, 'store']);
            Route::get('/orders/{id}', [CustomerOrderController::class, 'show']);
            Route::post('/orders/{id}/cancel', [CustomerOrderController::class, 'cancel']);
        });

        // ── Tenant side: staff management (owner or staff w/ staff.manage) ──
        Route::prefix('staff')->middleware(['role:shop_owner,staff', 'permission:staff.manage', 'subscription'])->group(function (): void {
            Route::get('/permissions', [TenantStaffController::class, 'permissions']);
            Route::get('/', [TenantStaffController::class, 'index']);
            Route::post('/', [TenantStaffController::class, 'store']);
            Route::get('/{staff}', [TenantStaffController::class, 'show']);
            Route::put('/{staff}', [TenantStaffController::class, 'update']);
            Route::delete('/{staff}', [TenantStaffController::class, 'destroy']);
        });
    });
});
