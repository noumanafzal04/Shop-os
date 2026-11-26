<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\OrderIssue;
use App\Services\OrderIssueService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Customers' problems with orders — the queue, and the answer to each. */
class OrderIssueController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $status = $request->query('status', 'open');

        $page = OrderIssue::query()
            ->when(in_array($status, ['open', 'resolved', 'rejected'], true), fn ($q) => $q->where('status', $status))
            ->when(array_key_exists((string) $request->query('kind'), OrderIssue::KINDS), fn ($q) => $q->where('kind', $request->query('kind')))
            ->when(trim((string) $request->query('search')) !== '', function ($q) use ($request) {
                $term = '%'.trim((string) $request->query('search')).'%';
                $q->where(fn ($w) => $w
                    ->where('note', 'like', $term)
                    ->orWhereHas('order', fn ($o) => $o->withoutGlobalScopes()->where(fn ($oo) => $oo
                        ->where('order_number', 'like', $term)->orWhere('customer_name', 'like', $term)->orWhere('customer_phone', 'like', $term)))
                    ->orWhereHas('tenant', fn ($t) => $t->where('business_name', 'like', $term)));
            })
            ->with(['order:id,order_number,tenant_id,customer_name,customer_phone,total,status,payment_method,placed_at,delivered_at', 'tenant:id,business_name,slug,settings', 'customer:id,name,phone'])
            ->orderBy($status === 'open' ? 'created_at' : 'resolved_at', $status === 'open' ? 'asc' : 'desc')
            ->stably()->paginate(min((int) $request->query('per_page', 20), 100))
            ->through(fn (OrderIssue $i) => $i->forCustomer() + [
                'order' => $i->order?->only(['id', 'order_number', 'customer_name', 'customer_phone', 'total', 'status', 'payment_method']) + [
                    'placed_at' => $i->order?->placed_at?->toIso8601String(),
                ],
                'shop' => $i->tenant?->only(['id', 'business_name', 'slug']) + [
                    'takes_vouchers' => (bool) $i->tenant?->featureEnabled('promotions'),
                ],
            ]);

        return ApiResponse::paginated($page, 'OK', [
            'open' => OrderIssue::query()->where('status', 'open')->count(),
        ]);
    }

    public function resolve(Request $request, string $id, OrderIssueService $issues): JsonResponse
    {
        $data = $request->validate([
            'outcome' => ['required', Rule::in(['refund', 'voucher', 'none'])],
            'amount' => ['nullable', 'numeric', 'min:1', 'required_unless:outcome,none'],
            'answer' => ['required', 'string', 'min:3', 'max:1000'],
        ]);

        $issue = $issues->resolve(
            OrderIssue::query()->findOrFail($id),
            $request->user(),
            $data['outcome'],
            isset($data['amount']) ? (float) $data['amount'] : null,
            $data['answer'],
        );

        return ApiResponse::ok($issue->forCustomer(), 'Answer sent to the customer');
    }
}
