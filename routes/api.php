<?php

use App\Http\Controllers\Api\V1\Admin\AnnouncementController;
use App\Http\Controllers\Api\V1\Admin\AuditLogController;
use App\Http\Controllers\Api\V1\Admin\BannerController as AdminBannerController;
use App\Http\Controllers\Api\V1\Admin\BillingController;
use App\Http\Controllers\Api\V1\Admin\DashboardController as AdminDashboardController;
use App\Http\Controllers\Api\V1\Admin\PlanController;
use App\Http\Controllers\Api\V1\Admin\StaffController as AdminStaffController;
use App\Http\Controllers\Api\V1\Admin\TenantController;
use App\Http\Controllers\Api\V1\Auth\AuthController;
use App\Http\Controllers\Api\V1\Auth\OtpController;
use App\Http\Controllers\Api\V1\Auth\PasswordController;
use App\Http\Controllers\Api\V1\Auth\RegisterController;
use App\Http\Controllers\Api\V1\Auth\SessionController;
use App\Http\Controllers\Api\V1\BusinessTypeController;
use App\Http\Controllers\Api\V1\CityController;
use App\Http\Controllers\Api\V1\Customer\AddressController as CustomerAddressController;
use App\Http\Controllers\Api\V1\DeviceController;
use App\Http\Controllers\Api\V1\Marketplace\BannerController as PublicBannerController;
use App\Http\Controllers\Api\V1\Marketplace\CustomerOrderController;
use App\Http\Controllers\Api\V1\Marketplace\CustomerReservationController;
use App\Http\Controllers\Api\V1\Marketplace\FavoriteController;
use App\Http\Controllers\Api\V1\Marketplace\MarketplaceController;
use App\Http\Controllers\Api\V1\Marketplace\ReviewController;
use App\Http\Controllers\Api\V1\NotificationController;
use App\Http\Controllers\Api\V1\Tenant\BatchController;
use App\Http\Controllers\Api\V1\Tenant\BranchController;
use App\Http\Controllers\Api\V1\Tenant\BusinessDayController;
use App\Http\Controllers\Api\V1\Tenant\CategoryController;
use App\Http\Controllers\Api\V1\Tenant\CollectionController;
use App\Http\Controllers\Api\V1\Tenant\CouponController;
use App\Http\Controllers\Api\V1\Tenant\CustomerController;
use App\Http\Controllers\Api\V1\Tenant\CustomerGroupController;
use App\Http\Controllers\Api\V1\Tenant\DashboardController;
use App\Http\Controllers\Api\V1\Tenant\DiningTableController;
use App\Http\Controllers\Api\V1\Tenant\ExpenseBudgetController;
use App\Http\Controllers\Api\V1\Tenant\ExpenseCategoryController;
use App\Http\Controllers\Api\V1\Tenant\ExpenseController;
use App\Http\Controllers\Api\V1\Tenant\ForecourtShiftController;
use App\Http\Controllers\Api\V1\Tenant\FuelDeliveryController;
use App\Http\Controllers\Api\V1\Tenant\FuelPriceController;
use App\Http\Controllers\Api\V1\Tenant\FuelSetupController;
use App\Http\Controllers\Api\V1\Tenant\GalleryController;
use App\Http\Controllers\Api\V1\Tenant\HardwareDeviceController;
use App\Http\Controllers\Api\V1\Tenant\IncomeCategoryController;
use App\Http\Controllers\Api\V1\Tenant\IncomeController;
use App\Http\Controllers\Api\V1\Tenant\InventoryController;
use App\Http\Controllers\Api\V1\Tenant\KitchenController;
use App\Http\Controllers\Api\V1\Tenant\OrderController;
use App\Http\Controllers\Api\V1\Tenant\PharmacyController;
use App\Http\Controllers\Api\V1\Tenant\PosController;
use App\Http\Controllers\Api\V1\Tenant\PosRegisterController;
use App\Http\Controllers\Api\V1\Tenant\ProductController;
use App\Http\Controllers\Api\V1\Tenant\ProductImageController;
use App\Http\Controllers\Api\V1\Tenant\PromotionController;
use App\Http\Controllers\Api\V1\Tenant\PurchaseOrderController;
use App\Http\Controllers\Api\V1\Tenant\ReceiptController;
use App\Http\Controllers\Api\V1\Tenant\RecurringExpenseController;
use App\Http\Controllers\Api\V1\Tenant\ReportController;
use App\Http\Controllers\Api\V1\Tenant\ReservationController;
use App\Http\Controllers\Api\V1\Tenant\RestaurantTicketController;
use App\Http\Controllers\Api\V1\Tenant\RiderController;
use App\Http\Controllers\Api\V1\Tenant\SaleController;
use App\Http\Controllers\Api\V1\Tenant\SaleDocumentController;
use App\Http\Controllers\Api\V1\Tenant\SearchController;
use App\Http\Controllers\Api\V1\Tenant\ShopController;
use App\Http\Controllers\Api\V1\Tenant\StaffController as TenantStaffController;
use App\Http\Controllers\Api\V1\Tenant\StockCountController;
use App\Http\Controllers\Api\V1\Tenant\SubscriptionController;
use App\Http\Controllers\Api\V1\Tenant\SupplierController;
use App\Http\Controllers\Api\V1\Tenant\SupplierPaymentController;
use App\Http\Controllers\Api\V1\Tenant\TaxGroupController;
use App\Http\Controllers\Api\V1\Tenant\TenantReviewController;
use App\Http\Controllers\Api\V1\Tenant\TillIdentityController;
use App\Http\Controllers\Api\V1\Tenant\TransferController;
use App\Http\Controllers\Api\V1\Tenant\VehicleController;
use App\Http\Controllers\Api\V1\Tenant\WarrantyController;
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
            // Your own till PIN. Sits with the password, because that is what
            // proves it is you setting it.
            Route::put('/till-pin', [TillIdentityController::class, 'setOwnPin']);
            Route::delete('/till-pin', [TillIdentityController::class, 'clearOwnPin']);
        });

        // ── Tenant side: shop profile, setup, dashboard ──────────────
        // 'subscription': read-only mode blocks writes after grace expiry.
        Route::middleware(['role:shop_owner,staff', 'subscription', 'branch', 'terminal'])->group(function (): void {
            Route::get('/dashboard', [DashboardController::class, 'index']);
            // Global search (⌘K palette) — self-gates each group by permission.
            Route::get('/search', [SearchController::class, 'index']);
            Route::get('/shop', [ShopController::class, 'show']);
            Route::put('/shop/setup', [ShopController::class, 'setup'])->middleware('permission:settings.manage');
            Route::put('/shop', [ShopController::class, 'update'])->middleware('permission:settings.manage');
            Route::get('/shop/settings', [ShopController::class, 'settings']);
            Route::get('/shop/subscription', [SubscriptionController::class, 'show']);
            Route::put('/shop/settings', [ShopController::class, 'updateSettings'])->middleware('permission:settings.manage');
            // Portfolio / gallery — a service business shows its work. Gated by
            // the services module: a mart or pharmacy has no portfolio.
            Route::middleware(['feature:services', 'permission:settings.manage'])->group(function (): void {
                Route::get('/shop/gallery', [GalleryController::class, 'index']);
                Route::post('/shop/gallery', [GalleryController::class, 'store']);
                Route::delete('/shop/gallery/{image}', [GalleryController::class, 'destroy']);
            });
            Route::post('/shop/logo', [ShopController::class, 'uploadLogo'])->middleware('permission:settings.manage');

            // Branches — physical locations under the tenant (multi-branch).
            // Every tenant has a default Main branch; adding more is gated by
            // the branches assigned to this shop.
            Route::middleware('permission:settings.manage')->group(function (): void {
                Route::get('branches', [BranchController::class, 'index']);
                Route::post('branches', [BranchController::class, 'store']);
                Route::put('branches/{branch}', [BranchController::class, 'update']);
                Route::delete('branches/{branch}', [BranchController::class, 'destroy']);
            });

            // Hardware registry — receipt/label printers, scanners, cash drawer.
            Route::middleware('permission:settings.manage')->group(function (): void {
                Route::get('hardware-devices', [HardwareDeviceController::class, 'index']);
                Route::post('hardware-devices', [HardwareDeviceController::class, 'store']);
                Route::put('hardware-devices/{device}', [HardwareDeviceController::class, 'update']);
                Route::delete('hardware-devices/{device}', [HardwareDeviceController::class, 'destroy']);
            });

            // Collections — storefront merchandising ("Summer Sale" shelves), so
            // they only exist for a shop that sells online. Same URIs as before,
            // pulled out of the catalog group to carry the marketplace gate.
            Route::middleware(['feature:marketplace', 'permission:products.manage'])->group(function (): void {
                Route::apiResource('collections', CollectionController::class);
            });

            // Catalog: categories + items (products & services).
            //
            // The module gate is ANY of products/services, because either one
            // alone justifies a catalog: a mart lists goods, a salon lists
            // labour, a workshop lists both. A books-only tenant has neither
            // and gets a straight MODULE_DISABLED — until now that shop was
            // stopped only by the item-type registry handing it no creatable
            // type, which reached the same place through a different door and
            // left the catalog as the one screen guarded unlike every other.
            Route::middleware(['feature:products,services', 'permission:products.manage'])->group(function (): void {
                Route::post('categories/reorder', [CategoryController::class, 'reorder']);
                Route::apiResource('categories', CategoryController::class);
                // Bulk CSV import (before the resource so /products/import isn't
                // captured by /products/{product}).
                Route::get('products/import/template', [ProductController::class, 'importTemplate']);
                Route::get('products/export', [ProductController::class, 'export']);
                Route::post('products/import', [ProductController::class, 'import']);
                Route::apiResource('products', ProductController::class);
                // Product images — multipart upload / delete
                Route::post('products/{product}/images', [ProductImageController::class, 'store']);
                Route::delete('products/{product}/images/{image}', [ProductImageController::class, 'destroy']);
                Route::post('products/{product}/barcode', [ProductController::class, 'generateBarcode']);
                // Cross-branch availability ("check other branches").
                Route::get('products/{product}/branch-stock', [ProductController::class, 'branchStock']);
                // Serial units on record (POS serial picker: in-stock by default).
                Route::get('products/{product}/serials', [ProductController::class, 'serials']);
                // Per-branch price overrides (effective = override ?? base).
                Route::get('products/{product}/branch-prices', [ProductController::class, 'branchPrices']);
                Route::put('products/{product}/branch-prices', [ProductController::class, 'setBranchPrices']);
                Route::put('products/{product}/modifier-groups', [ProductController::class, 'syncModifiers']);
                // Tax groups — named reusable rates products can point at.
                Route::apiResource('tax-groups', TaxGroupController::class)
                    ->only(['index', 'store', 'update', 'destroy']);
            });

            // Customers — CRM directory (auto-captured from sales/orders)
            Route::middleware('permission:customers.manage')->group(function (): void {
                // Khata repayment — pay down a customer's credit balance.
                Route::post('customers/{customer}/payments', [CustomerController::class, 'recordPayment']);
                Route::get('customers/export', [CustomerController::class, 'export']);
                // Customer groups — tiered pricing segments.
                Route::apiResource('customer-groups', CustomerGroupController::class)
                    ->only(['index', 'store', 'update', 'destroy']);
                Route::apiResource('customers', CustomerController::class);
            });

            // Vehicles — a tyre or auto shop's real customer key. Sits under
            // customers.manage because a vehicle IS customer data; the lookup
            // below is separated for the same reason the customer one is, so a
            // cashier can attach a plate without holding the CRM permission.
            Route::middleware('permission:customers.manage')->group(function (): void {
                Route::get('vehicles/{vehicle}/history', [VehicleController::class, 'history']);
                Route::post('vehicles/{vehicle}/link-customer', [VehicleController::class, 'linkCustomer']);
                Route::apiResource('vehicles', VehicleController::class);
            });

            // POS customer lookup by phone — loyalty points + credit for the
            // till (cashiers have sales.manage, not necessarily customers.manage).
            Route::get('customers-lookup', [CustomerController::class, 'lookup'])
                ->middleware('permission:sales.manage');

            // Same reasoning for the plate: the person on the till needs to
            // find (and register) a vehicle mid-sale.
            Route::middleware('permission:sales.manage')->group(function (): void {
                Route::get('vehicles-lookup', [VehicleController::class, 'index']);
                Route::post('vehicles-quick', [VehicleController::class, 'store']);
            });

            // Coupons — discount codes for POS + checkout
            Route::middleware('permission:coupons.manage')->group(function (): void {
                Route::post('coupons/validate', [CouponController::class, 'validateCode']);
                Route::apiResource('coupons', CouponController::class);
            });

            // Promotions — automatic scheduled discounts (no code). CRUD is
            // marketing (coupons.manage); the POS preview is a cashier read.
            Route::post('promotions/preview', [PromotionController::class, 'preview'])
                ->middleware('permission:sales.manage');
            Route::middleware('permission:coupons.manage')->group(function (): void {
                Route::apiResource('promotions', PromotionController::class)
                    ->only(['index', 'store', 'update', 'destroy']);
            });

            // Suppliers — vendor directory + payables. Part of the stock chain,
            // so it rides the inventory module.
            Route::middleware(['feature:inventory', 'permission:suppliers.manage'])->group(function (): void {
                Route::apiResource('suppliers', SupplierController::class);
            });

            // Purchases: Supplier → PO → Receive → Inventory
            Route::middleware(['feature:inventory', 'permission:purchases.manage'])->group(function (): void {
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
                // Terminal handover — carry an open drawer to another lane.
                Route::post('/session/move', [PosController::class, 'moveSession']);
                Route::post('/session/close', [PosController::class, 'closeSession']);
                // The live X-read: what this drawer should hold right now.
                Route::get('/session/report', [PosController::class, 'sessionReport']);
                // Non-sale cash: paid-in, paid-out, safe drop, float top-up, no-sale.
                Route::get('/session/movements', [PosController::class, 'movements']);
                Route::post('/session/movements', [PosController::class, 'storeMovement']);
                Route::get('/held', [PosController::class, 'heldIndex']);
                Route::post('/held', [PosController::class, 'heldStore']);
                // Claim = resume atomically, so only one lane can take it.
                Route::post('/held/{id}/claim', [PosController::class, 'heldClaim']);
                Route::delete('/held/{id}', [PosController::class, 'heldDestroy']);
                // Which lane am I, and what hardware do I drive?
                Route::get('/terminal', [PosRegisterController::class, 'terminal']);
                Route::get('/registers', [PosRegisterController::class, 'lanes']);
                // Who is at the till. The roster and the PIN handover — the
                // outgoing cashier's session on this device ends with it.
                Route::get('/till-users', [TillIdentityController::class, 'roster']);
                Route::post('/unlock', [TillIdentityController::class, 'unlock'])
                    // A PIN is short. Even scoped to an already-signed-in till,
                    // it never gets an unmetered guessing rate.
                    ->middleware('throttle:10,1');
                // Manager-only lane operations: the consolidated day view and
                // force-closing a drawer the cashier walked away from.
                // The Z-read for a shift already counted out. Same permission
                // as ringing sales: a cashier is entitled to the record of
                // their own drawer, and withholding it is how a disputed shift
                // becomes one person's word.
                Route::get('/sessions/{session}/z-report', [PosController::class, 'zReport']);
                Route::get('/sessions/{session}/z-report/print', [PosController::class, 'zReportPrint']);

                // The trading day. Reading it is open to anyone on the floor;
                // closing it off is the sign-off on every cashier's variance,
                // so that stays manager-only (checked in the controller).
                Route::get('/day', [BusinessDayController::class, 'current']);
                Route::get('/days', [BusinessDayController::class, 'index']);
                Route::get('/days/{day}', [BusinessDayController::class, 'show']);
                Route::post('/days/{day}/close', [BusinessDayController::class, 'close']);
                Route::get('/deposits', [BusinessDayController::class, 'deposits']);
                Route::post('/deposits', [BusinessDayController::class, 'storeDeposit']);

                Route::middleware('permission:settings.manage')->group(function (): void {
                    Route::get('/sessions', [PosController::class, 'sessions']);
                    Route::post('/registers/{register}/close', [PosController::class, 'forceCloseSession']);
                });
            });

            // Registers (checkout lanes / tills) — configuration, so the same
            // permission as branches and hardware. Gated by the POS module: an
            // online-only shop has no lanes.
            Route::middleware(['feature:pos', 'permission:settings.manage'])->group(function (): void {
                Route::get('registers', [PosRegisterController::class, 'index']);
                Route::post('registers', [PosRegisterController::class, 'store']);
                Route::put('registers/{register}', [PosRegisterController::class, 'update']);
                Route::delete('registers/{register}', [PosRegisterController::class, 'destroy']);
            });

            // Sales: workflow → payment → invoice → stock decrement
            Route::prefix('sales')->middleware('permission:sales.manage')->group(function (): void {
                Route::get('/', [SaleController::class, 'index']);
                // Export before /{sale} so it isn't captured as an id.
                Route::get('/export', [SaleController::class, 'export']);
                // Ringing up a counter sale needs the POS module; viewing and
                // refunding sales stays open (online sales appear here too).
                Route::post('/', [SaleController::class, 'store'])->middleware('feature:pos');
                Route::get('/{sale}', [SaleController::class, 'show']);
                // Voiding and refunding are separated from ringing sales: they
                // restore stock and reverse money, so a cashier holding only
                // sales.manage can no longer erase a completed sale or hand
                // cash back. Owners hold every tenant permission implicitly.
                Route::post('/{sale}/cancel', [SaleController::class, 'cancel'])
                    ->middleware('permission:sales.void');
                Route::post('/{sale}/returns', [SaleController::class, 'processReturn'])
                    ->middleware('permission:sales.refund');
                // Exchange rings a replacement sale, so it needs the POS module.
                // It also returns goods, hence the refund permission.
                Route::post('/{sale}/exchange', [SaleController::class, 'exchange'])
                    ->middleware(['feature:pos', 'permission:sales.refund']);
                // Receipts. Rendering one is a counter action, not a report:
                // the render itself is what gets logged, and the log is what
                // decides whether the paper says ORIGINAL or REPRINT.
                Route::get('/{sale}/invoice', [ReceiptController::class, 'show']);
                Route::get('/{sale}/receipt-prints', [ReceiptController::class, 'trail']);
            });

            // What the receipt will look like — rendered from the settings
            // being edited, against a sample sale. Nothing is written. It sits
            // beside the receipt settings, so it carries the settings gate.
            Route::get('receipts/preview', [ReceiptController::class, 'preview'])
                ->middleware('permission:settings.manage');

            // Receipt plumbing at the till.
            Route::middleware('permission:sales.manage')->group(function (): void {
                // The reprint tray: receipts the till was told never came out.
                Route::get('receipts/pending', [ReceiptController::class, 'pending']);
                Route::post('receipt-prints/{print}/outcome', [ReceiptController::class, 'outcome']);
            });

            // Copies per cashier — the control that makes logging them worth
            // anything, so it sits with the manager, not the till.
            Route::get('reports/reprints', [ReceiptController::class, 'reprintReport'])
                ->middleware('permission:reports.view');

            // Quotations & layaway — the two promises a retailer makes before a
            // sale exists. Both ride the POS module: they are counter documents
            // that end in a till transaction, and a shop with no counter has
            // nowhere to take an advance or hand the goods over.
            Route::prefix('sale-documents')->middleware(['feature:pos', 'permission:sales.manage'])->group(function (): void {
                Route::get('/', [SaleDocumentController::class, 'index']);
                // Before /{document} so it isn't captured as an id.
                Route::get('/summary', [SaleDocumentController::class, 'summary']);
                Route::post('/', [SaleDocumentController::class, 'store']);
                Route::get('/{document}', [SaleDocumentController::class, 'show']);
                Route::get('/{document}/print', [SaleDocumentController::class, 'print']);
                Route::post('/{document}/deposits', [SaleDocumentController::class, 'deposit']);
                Route::post('/{document}/convert', [SaleDocumentController::class, 'convert']);
                // Cancelling a layaway that holds money needs sales.refund —
                // enforced in the controller, since a quotation cancel moves
                // nothing and must stay available to a plain cashier.
                Route::post('/{document}/cancel', [SaleDocumentController::class, 'cancel']);
            });

            // Pharmacy depth. Rides the inventory module rather than a module
            // of its own: substitution reads stock, the register reads batches,
            // and a shop without inventory has neither.
            Route::prefix('pharmacy')->middleware('feature:inventory')->group(function (): void {
                // At the counter: the brand is out, what else has the same salt?
                Route::get('alternatives', [PharmacyController::class, 'alternatives'])
                    ->middleware('permission:sales.manage');
                // The register a regulator asks to see.
                Route::get('dispensing', [PharmacyController::class, 'dispensing'])
                    ->middleware('permission:reports.view');
                // A withdrawal notice names a lot; this finds who took it home.
                Route::get('recall', [PharmacyController::class, 'recall'])
                    ->middleware('permission:inventory.manage');
            });

            // Warranty desk (serialized retail): look up a serial / IMEI to see
            // what was sold and whether it's still under warranty.
            // Serialized selling rides stock tracking, so it needs inventory too.
            Route::get('warranty/lookup', [WarrantyController::class, 'lookup'])
                ->middleware(['feature:inventory', 'permission:sales.manage']);

            // Inventory: the single write-path for stock
            Route::prefix('inventory')->middleware(['feature:inventory', 'permission:inventory.manage'])->group(function (): void {
                Route::post('/adjust', [InventoryController::class, 'adjust']);
                Route::get('/movements', [InventoryController::class, 'movements']);
                Route::get('/low-stock', [InventoryController::class, 'lowStock']);
                // Batch/lot + expiry tracking (pharmacy, perishables)
                Route::get('/expiring', [BatchController::class, 'expiring']);
                Route::get('/products/{product}/batches', [BatchController::class, 'index']);
                Route::post('/products/{product}/batches', [BatchController::class, 'store']);
                Route::patch('/batches/{batch}', [BatchController::class, 'update']);
                Route::delete('/batches/{batch}', [BatchController::class, 'destroy']);

                // Branch-to-branch transfers (multi-branch).
                Route::get('/transfers', [TransferController::class, 'index']);
                Route::post('/transfers', [TransferController::class, 'store']);

                // Stocktake. Counting is floor work, so anyone who manages
                // stock may draw a sheet and enter figures; APPLYING it writes
                // off stock against the shop's own books and is manager-only
                // (checked in the controller).
                Route::get('/counts', [StockCountController::class, 'index']);
                Route::get('/counts/current', [StockCountController::class, 'current']);
                Route::post('/counts', [StockCountController::class, 'store']);
                Route::get('/counts/{count}', [StockCountController::class, 'show']);
                Route::post('/counts/{count}/lines', [StockCountController::class, 'record']);
                Route::post('/counts/{count}/apply', [StockCountController::class, 'apply']);
                Route::delete('/counts/{count}', [StockCountController::class, 'destroy']);
            });

            // Expense categories (templates from business type, editable).
            // The Expense Manager is an admin-controlled module — a shop that
            // only sells (e.g. a food stall) can have it switched off.
            Route::middleware(['feature:expenses', 'permission:expenses.manage'])->group(function (): void {
                Route::apiResource('expense-categories', ExpenseCategoryController::class)
                    ->except(['show']);
                // Recurring templates BEFORE the resource, or "recurring" is
                // swallowed as an {expense} id.
                Route::get('expenses/recurring', [RecurringExpenseController::class, 'index']);
                Route::post('expenses/recurring', [RecurringExpenseController::class, 'store']);
                Route::put('expenses/recurring/{recurring}', [RecurringExpenseController::class, 'update']);
                Route::delete('expenses/recurring/{recurring}', [RecurringExpenseController::class, 'destroy']);
                Route::post('expenses/recurring/{recurring}/post', [RecurringExpenseController::class, 'post']);

                // Category ceilings + how the month is tracking against them.
                Route::get('expenses/budgets', [ExpenseBudgetController::class, 'index']);
                Route::post('expenses/budgets', [ExpenseBudgetController::class, 'store']);

                // Before the resource, or "export" is swallowed as an {expense}.
                Route::get('expenses/export', [ExpenseController::class, 'export']);
                Route::apiResource('expenses', ExpenseController::class)->except(['show']);
                // The photo of the bill.
                Route::post('expenses/{expense}/attachment', [ExpenseController::class, 'attach']);
                Route::delete('expenses/{expense}/attachment', [ExpenseController::class, 'detach']);

                // Income is the other half of the same module.
                Route::apiResource('income-categories', IncomeCategoryController::class)
                    ->except(['show']);
                Route::get('incomes/export', [IncomeController::class, 'export']);
                Route::apiResource('incomes', IncomeController::class)->except(['show']);

                // Cashbook: unified money-in / money-out ledger. DERIVES sales
                // revenue + refunds + expenses (never duplicates them) and adds
                // the manual income entries — a day-by-day running balance.
                Route::get('/cashbook', [ReportController::class, 'cashbook']);

                // The ledger is the Cashbook at line level: every movement, in
                // the order it happened, balance carried down. It rides the
                // Expense module rather than reports.view because for a
                // books-only shop this IS the module they bought — gating it
                // behind a reporting permission would put a Finance Manager's
                // only real screen out of their own reach.
                Route::get('/ledger', [ReportController::class, 'ledger']);
                Route::get('/ledger/export', [ReportController::class, 'exportLedger']);
            });

            // Reports
            Route::middleware('permission:reports.view')->group(function (): void {
                Route::get('/reports/summary', [ReportController::class, 'summary']);
                Route::get('/reports/purchases', [ReportController::class, 'purchases']);
                Route::get('/reports/staff', [ReportController::class, 'staff']);
                Route::get('/reports/tax', [ReportController::class, 'tax']);
                // What each item actually earned — revenue crowns whatever is
                // expensive, margin crowns what pays.
                Route::get('/reports/margins', [ReportController::class, 'margins']);
                Route::get('/reports/margins/export', [ReportController::class, 'exportMargins']);

                // Stock-shaped reports: they read the shelves, so they need the
                // stock module as well as the reporting permission.
                Route::middleware('feature:inventory')->group(function (): void {
                    Route::get('/reports/valuation', [ReportController::class, 'valuation']);
                    Route::get('/reports/valuation/export', [ReportController::class, 'exportValuation']);
                    Route::get('/reports/dead-stock', [ReportController::class, 'deadStock']);
                    Route::get('/reports/dead-stock/export', [ReportController::class, 'exportDeadStock']);
                });
            });

            // Reviews (owner side: view + reply) — customers can only review a
            // shop that's listed online, so this is marketplace-only.
            Route::middleware('feature:marketplace')->group(function (): void {
                Route::get('/reviews', [TenantReviewController::class, 'index']);
                Route::get('/reviews/summary', [TenantReviewController::class, 'summary']);
                Route::post('/reviews/{id}/reply', [TenantReviewController::class, 'reply'])
                    ->middleware('permission:settings.manage');
            });

            // Orders (owner side) — online checkouts AND the ones the shop
            // takes itself over the phone or WhatsApp.
            //
            // Gated on `products`, not `marketplace`: a pharmacy that delivers
            // but sells nothing online has marketplace off, and gating here
            // meant it could manage riders (correctly gated on `delivery`) but
            // never see an order to give one. A shop that takes no orders at
            // all simply has an empty list.
            Route::prefix('orders')->middleware(['feature:products', 'permission:orders.manage'])->group(function (): void {
                Route::get('/', [OrderController::class, 'index']);
                // A call, a WhatsApp message, someone at the counter asking for
                // delivery. Server-priced like any other order.
                Route::post('/', [OrderController::class, 'store']);
                Route::get('/{id}', [OrderController::class, 'show']);
                Route::post('/{id}/advance', [OrderController::class, 'advance']);
                Route::post('/{id}/assign-rider', [OrderController::class, 'assignRider']);
                Route::post('/{id}/cancel', [OrderController::class, 'cancel']);
            });

            // Delivery riders (Model A — the shop's own riders). Gated on
            // DELIVERY, not marketplace: a pharmacy takes phone orders and
            // delivers them while selling nothing online (marketplace=F,
            // delivery=T), and must still manage its riders.
            Route::middleware(['feature:delivery', 'permission:orders.manage'])->group(function (): void {
                Route::get('/riders', [RiderController::class, 'index']);
                Route::post('/riders', [RiderController::class, 'store']);
                Route::patch('/riders/{id}', [RiderController::class, 'update']);
                Route::delete('/riders/{id}', [RiderController::class, 'destroy']);
            });

            // Reservations (owner side)
            Route::prefix('reservations')->middleware(['feature:reservations', 'permission:reservations.manage'])->group(function (): void {
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
                    // The floor moves: a party changes table, two tabs become
                    // one, a section changes hands at shift change.
                    Route::post('tickets/{ticket}/move', [RestaurantTicketController::class, 'move']);
                    Route::post('tickets/{ticket}/merge', [RestaurantTicketController::class, 'merge']);
                    Route::post('tickets/{ticket}/waiter', [RestaurantTicketController::class, 'assignWaiter']);

                    // The kitchen screen. Same permission as the floor: in a
                    // small kitchen the same person cooks and rings up, and a
                    // separate permission would just go ungranted.
                    Route::get('kitchen', [KitchenController::class, 'board']);
                    Route::post('kitchen/kot/{kot}/bump', [KitchenController::class, 'bump']);
                });

                // Covers and takings per waiter — a service report, so it sits
                // with the other reports' permission.
                Route::get('reports/waiters', [RestaurantTicketController::class, 'waiterReport'])
                    ->middleware('permission:reports.view');
            });

            // Fuel management (petroleum depth): the forecourt a petrol pump
            // runs on — tanks, pumps and nozzles, the shift that reads every
            // meter and dips every tank, and the tankers that fill them.
            // Gated by the `fuel` module (defaults on for petroleum only).
            Route::prefix('fuel')->middleware('feature:fuel')->group(function (): void {
                // The plant. Set up once, so it sits with the other
                // configuration behind settings.manage.
                Route::middleware('permission:settings.manage')->group(function (): void {
                    Route::get('tanks', [FuelSetupController::class, 'tanks']);
                    Route::post('tanks', [FuelSetupController::class, 'storeTank']);
                    Route::put('tanks/{tank}', [FuelSetupController::class, 'updateTank']);
                    Route::delete('tanks/{tank}', [FuelSetupController::class, 'destroyTank']);

                    Route::get('pumps', [FuelSetupController::class, 'pumps']);
                    Route::post('pumps', [FuelSetupController::class, 'storePump']);
                    Route::put('pumps/{pump}', [FuelSetupController::class, 'updatePump']);
                    Route::delete('pumps/{pump}', [FuelSetupController::class, 'destroyPump']);
                    Route::post('pumps/{pump}/nozzles', [FuelSetupController::class, 'storeNozzle']);
                    Route::put('pumps/{pump}/nozzles/{nozzle}', [FuelSetupController::class, 'updateNozzle']);
                    Route::delete('pumps/{pump}/nozzles/{nozzle}', [FuelSetupController::class, 'destroyNozzle']);
                });

                // The shift. A stock reconciliation at heart — it ends by
                // setting fuel stock to the dip — so it carries the same
                // permission as every other stock correction.
                Route::middleware('permission:inventory.manage')->group(function (): void {
                    Route::get('shifts', [ForecourtShiftController::class, 'index']);
                    Route::get('shifts/current', [ForecourtShiftController::class, 'current']);
                    Route::post('shifts', [ForecourtShiftController::class, 'store']);
                    Route::get('shifts/{shift}', [ForecourtShiftController::class, 'show']);
                    Route::post('shifts/{shift}/close', [ForecourtShiftController::class, 'close']);
                });

                // Goods received, so it sits with purchasing.
                Route::middleware('permission:purchases.manage')->group(function (): void {
                    Route::get('deliveries', [FuelDeliveryController::class, 'index']);
                    Route::post('deliveries', [FuelDeliveryController::class, 'store']);
                });

                // A price notification changes a product price.
                Route::middleware('permission:products.manage')->group(function (): void {
                    Route::get('prices', [FuelPriceController::class, 'index']);
                    Route::post('prices', [FuelPriceController::class, 'store']);
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
            // Till PINs for staff — an owner hands a new cashier one on their
            // first shift, the same way they'd set a password.
            Route::put('/{staff}/pin', [TillIdentityController::class, 'setStaffPin']);
            Route::delete('/{staff}/pin', [TillIdentityController::class, 'clearStaffPin']);
            Route::get('/', [TenantStaffController::class, 'index']);
            Route::post('/', [TenantStaffController::class, 'store']);
            Route::get('/{staff}', [TenantStaffController::class, 'show']);
            Route::put('/{staff}', [TenantStaffController::class, 'update']);
            Route::delete('/{staff}', [TenantStaffController::class, 'destroy']);
        });
    });
});
