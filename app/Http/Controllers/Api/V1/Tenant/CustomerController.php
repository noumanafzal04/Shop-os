<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Enums\SaleStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Customer\RecordCustomerPaymentRequest;
use App\Http\Requests\Customer\StoreCustomerRequest;
use App\Http\Requests\Customer\UpdateCustomerRequest;
use App\Models\Customer;
use App\Models\Order;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CustomerController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $customers = Customer::query()
            ->withCount(['sales as sales_count' => fn ($q) => $q->where('status', '!=', SaleStatus::Cancelled->value)])
            ->withSum(['sales as sales_total' => fn ($q) => $q->where('status', '!=', SaleStatus::Cancelled->value)], 'total')
            ->when($request->query('search'), fn ($q, $s) => $q->where(function ($q) use ($s): void {
                $q->where('name', 'like', "%{$s}%")->orWhere('phone', 'like', "%{$s}%")->orWhere('email', 'like', "%{$s}%");
            }))
            ->orderByDesc('last_seen_at')
            ->paginate(min((int) $request->query('per_page', 20), 100));

        return ApiResponse::paginated($customers);
    }

    public function store(StoreCustomerRequest $request): JsonResponse
    {
        $customer = Customer::query()->create($request->validated());

        return ApiResponse::created($customer, 'Customer added');
    }

    public function show(string $id): JsonResponse
    {
        /** @var Customer $customer */
        $customer = Customer::query()->findOrFail($id);

        // Walk-in sales are linked; online orders match by phone snapshot.
        $sales = $customer->sales()->where('status', '!=', SaleStatus::Cancelled->value)
            ->latest('sold_at')->limit(50)->get(['id', 'invoice_number', 'total', 'channel', 'sold_at']);

        $orders = $customer->phone
            ? Order::query()->where('customer_phone', $customer->phone)
                ->latest('placed_at')->limit(50)->get(['id', 'order_number', 'total', 'status', 'placed_at'])
            : collect();

        $customer->setAttribute('history', [
            'sales' => $sales,
            'orders' => $orders,
            'total_spent' => round((float) $sales->sum('total') + (float) $orders->sum('total'), 2),
            'orders_count' => $sales->count() + $orders->count(),
        ]);

        // Khata statement — most recent ledger movements.
        $customer->setAttribute('ledger', $customer->ledgerEntries()->limit(50)->get());

        return ApiResponse::ok($customer);
    }

    /**
     * Record a repayment against the customer's khata (credit balance).
     */
    public function recordPayment(RecordCustomerPaymentRequest $request, string $id): JsonResponse
    {
        /** @var Customer $customer */
        $customer = Customer::query()->findOrFail($id);
        $data = $request->validated();

        $entry = $customer->recordCreditPayment(
            (float) $data['amount'],
            $data['method'],
            $data['reference'] ?? null,
            $data['note'] ?? null,
        );

        return ApiResponse::created([
            'entry' => $entry,
            'credit_balance' => (float) $customer->fresh()->credit_balance,
        ], 'Payment recorded');
    }

    public function update(UpdateCustomerRequest $request, string $id): JsonResponse
    {
        $customer = Customer::query()->findOrFail($id);
        $customer->update($request->validated());

        return ApiResponse::ok($customer, 'Customer updated');
    }

    public function destroy(string $id): JsonResponse
    {
        Customer::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Customer deleted');
    }
}
