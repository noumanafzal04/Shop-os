<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\HardwareDevice;
use App\Models\ReceiptPrint;
use App\Models\Register;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SalePayment;
use App\Models\User;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\RegisterContext;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * Receipts: rendering them, and knowing which ones actually got printed.
 *
 * The counter's version of this is simple — "print it again" — but the shop's
 * version is not. A receipt is the only artefact that leaves the building, so
 * a second copy of one is a control problem, and a browser POS can never be
 * sure a print landed. Both facts live here.
 */
class ReceiptController extends Controller
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchContext $branch,
        private readonly RegisterContext $terminal,
    ) {}

    /**
     * Print-ready HTML receipt. Every render is logged, and the log decides
     * what the paper says: the first receipt off a sale is the original, every
     * one after it is stamped REPRINT. The client cannot ask for a second
     * "original" — that is the point.
     *
     * ?copy=gift suppresses prices (the recipient must not see what was paid).
     */
    public function show(string $id, Request $request): Response
    {
        $data = $request->validate([
            'copy' => ['sometimes', 'nullable', Rule::in([ReceiptPrint::GIFT])],
            'reason' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);

        // Practice included — printing the receipt is most of what a trainee is
        // there to learn, and the paper stamps TRAINING across itself.
        $sale = Sale::withTraining()
            ->with(['items', 'payments', 'tradeIns', 'serials', 'branch:id,name', 'register:id,name,code'])
            ->findOrFail($id);

        $tenant = $this->tenant->get();
        $settings = $tenant->allSettings();

        $copyNo = ReceiptPrint::nextCopyNo($sale->id);
        $kind = ($data['copy'] ?? null) === ReceiptPrint::GIFT
            ? ReceiptPrint::GIFT
            : ($copyNo === 1 ? ReceiptPrint::ORIGINAL : ReceiptPrint::REPRINT);

        // Which printer this lane drives — recorded so a run of failures can be
        // traced to one device rather than blamed on "the system".
        $register = $this->terminal->get();
        $printer = HardwareDevice::resolveForRegister($register?->id)['receipt_printer'] ?? null;

        // Resolved once, here, because two callers need the answer: the
        // template that lays the page out, and the till that wants to tell the
        // cashier which paper it just went to.
        $paper = $this->paperFor($printer) ?? (string) ($settings['receipt_width'] ?? 'standard');

        $print = ReceiptPrint::query()->create([
            'sale_id' => $sale->id,
            'branch_id' => $sale->branch_id ?? $this->branch->id(),
            'register_id' => $register?->id ?? $sale->register_id,
            'device_id' => $printer?->id,
            'user_id' => $request->user()?->id,
            'kind' => $kind,
            'copy_no' => $copyNo,
            // Optimistic: the job was handed over. The client reports back if
            // it wasn't — see outcome(). Logging it as queued instead would
            // leave a ghost row behind every receipt someone merely previewed.
            'status' => ReceiptPrint::PRINTED,
            'transport' => $printer?->connection_type ?? 'browser',
            'reason' => $data['reason'] ?? null,
            'printed_at' => now(),
        ]);

        return response()
            ->view('invoices.show', [
                'sale' => $sale,
                'tenant' => $tenant,
                'settings' => $settings,
                // What THIS lane's printer actually holds, which is not always
                // what the shop's default says. A shop that issues A4 invoices
                // and puts an 80mm thermal on Lane 2 was getting a correct test
                // page and a wrong receipt: the device's paper size was stored,
                // validated, and read by nothing but its own test print.
                //
                // Null falls through to the shop setting inside the template,
                // which is where every other document already resolves it.
                'paper' => $paper,
                'kind' => $kind,
                'copyNo' => $copyNo,
                'cashier' => $this->cashierName($sale),
                'reprintCount' => max(0, $copyNo - 1),
            ])
            // The client needs the row id to report a failure against it.
            ->header('X-Receipt-Print-Id', $print->id)
            ->header('X-Receipt-Kind', $kind)
            // WHICH PAPER THIS CAME OUT ON.
            //
            // A shop picks "Thermal 80mm" in Settings, rings a sale, and the
            // till says nothing about paper at all — so the only way to find
            // out whether the choice took effect was to print one and look at
            // it. Worse, the lane's own printer legitimately overrides the
            // shop default (see paperFor), so the setting screen cannot answer
            // it either: the honest answer is per-lane and only known here.
            //
            // Sent as a header rather than recomputed in the client, because
            // the resolution rule already lives in one place and a second copy
            // in TypeScript is a copy that drifts.
            ->header('X-Receipt-Paper', $paper);
    }

    /**
     * A printer's own paper, in the vocabulary the templates speak.
     *
     * The hardware registry records `58mm | 80mm | a4` because that is what is
     * written on the box; the templates say `thermal_58 | thermal_80 |
     * standard` because that is what the shop setting has always said. Two
     * vocabularies for one thing is a translation, and this is the one place it
     * happens rather than in three Blade files.
     *
     * Null means "this lane has nothing to say" — no printer registered, or one
     * registered without a size — and the shop's own setting decides, exactly as
     * it did before.
     */
    private function paperFor(?HardwareDevice $printer): ?string
    {
        return match ($printer?->settings['paper_size'] ?? null) {
            '58mm' => 'thermal_58',
            '80mm' => 'thermal_80',
            'a4' => 'standard',
            default => null,
        };
    }

    /**
     * The same template, rendered against a made-up sale, so the shopkeeper can
     * see a receipt while they are editing what goes on one.
     *
     * Settings arrive as query parameters and override what is saved, which is
     * the whole point — the preview has to answer "what will this look like if
     * I keep this change", not "what did it look like before I started".
     *
     * Nothing is written: no sale, no print row. The paper says so too.
     */
    public function preview(Request $request): Response
    {
        $overrides = $request->validate([
            'invoice_header' => ['sometimes', 'nullable', 'string', 'max:200'],
            'invoice_footer' => ['sometimes', 'nullable', 'string', 'max:300'],
            'invoice_show_logo' => ['sometimes', 'boolean'],
            'receipt_width' => ['sometimes', 'in:standard,thermal_80,thermal_58'],
            'receipt_show_cashier' => ['sometimes', 'boolean'],
            'invoice_ntn' => ['sometimes', 'nullable', 'string', 'max:30'],
            'invoice_strn' => ['sometimes', 'nullable', 'string', 'max:30'],
            'invoice_fbr_pos_id' => ['sometimes', 'nullable', 'string', 'max:30'],
            'currency_symbol' => ['sometimes', 'string', 'max:5'],
            'tax_inclusive' => ['sometimes', 'boolean'],
            'kind' => ['sometimes', Rule::in(ReceiptPrint::KINDS)],
        ]);

        $kind = $overrides['kind'] ?? ReceiptPrint::ORIGINAL;
        unset($overrides['kind']);

        $tenant = $this->tenant->get();

        return response()->view('invoices.show', [
            'sale' => $this->sampleSale((bool) ($overrides['tax_inclusive'] ?? $tenant->allSettings()['tax_inclusive'] ?? false)),
            'tenant' => $tenant,
            'settings' => [...$tenant->allSettings(), ...$overrides],
            'kind' => $kind,
            'copyNo' => $kind === ReceiptPrint::REPRINT ? 2 : 1,
            'cashier' => $request->user()?->name ?? 'Cashier',
            'preview' => true,
        ]);
    }

    /**
     * A believable sale to render the preview against: two lines, a discount,
     * tax, and a split tender — enough that every band of the receipt has
     * something in it and nothing silently collapses.
     */
    private function sampleSale(bool $taxInclusive): Sale
    {
        $sale = new Sale([
            'invoice_number' => 'INV-000123',
            'channel' => 'pos',
            'status' => 'completed',
            'customer_name' => 'Ahmed Raza',
            'customer_phone' => '0300 1234567',
            'subtotal' => 2450.00,
            'discount' => 200.00,
            'promo_discount' => 0,
            'tax' => 382.50,
            'tax_inclusive' => $taxInclusive,
            'total' => 2632.50,
            'payment_method' => 'split',
            'amount_paid' => 2632.50,
            'change_due' => 67.50,
            'points_earned' => 26,
            'points_redeemed' => 0,
            'sold_at' => now(),
        ]);

        $sale->setRelation('items', collect([
            new SaleItem([
                'product_name' => 'Basmati Rice', 'unit_name' => '5 kg bag', 'sku' => 'RICE-5K',
                'quantity' => 2, 'unit_price' => 950.00, 'line_discount' => 0, 'line_total' => 1900.00,
            ]),
            new SaleItem([
                'product_name' => 'Cooking Oil', 'variant_name' => '1 L', 'sku' => 'OIL-1L',
                'quantity' => 2, 'unit_price' => 325.00, 'line_discount' => 100.00, 'line_total' => 550.00,
            ]),
        ]));

        $sale->setRelation('payments', collect([
            new SalePayment(['method' => 'cash', 'amount' => 1700.00]),
            new SalePayment(['method' => 'card', 'amount' => 1000.00, 'reference' => '**** 4417']),
        ]));

        $sale->setRelation('serials', collect());
        $sale->setRelation('branch', new Branch(['name' => 'Main']));
        $sale->setRelation('register', new Register(['name' => 'Counter 1']));

        return $sale;
    }

    /**
     * The client reporting what happened to a print job. A browser POS only
     * ever learns this from the browser, so "failed" means the print call
     * threw or the cashier said no paper came out — never a device ack.
     */
    public function outcome(string $printId, Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in([ReceiptPrint::PRINTED, ReceiptPrint::FAILED])],
            'error' => ['sometimes', 'nullable', 'string', 'max:200'],
        ]);

        $print = ReceiptPrint::query()->findOrFail($printId);
        $print->update([
            'status' => $data['status'],
            'error' => $data['status'] === ReceiptPrint::FAILED ? ($data['error'] ?? null) : null,
        ]);

        return ApiResponse::ok($print->fresh(), 'Print outcome recorded');
    }

    /** The print trail for one sale — what was handed over, to whom, when. */
    public function trail(string $saleId): JsonResponse
    {
        $sale = Sale::query()->findOrFail($saleId);

        $prints = ReceiptPrint::query()
            ->with(['user:id,name', 'register:id,name'])
            ->where('sale_id', $sale->id)
            ->orderBy('copy_no')
            ->get();

        return ApiResponse::ok($prints);
    }

    /**
     * The reprint tray: sales whose receipt failed and never printed since.
     *
     * Derived, not a queue — a later successful print for the same sale clears
     * it automatically, so nothing has to be marked resolved by hand and the
     * tray cannot drift out of step with what the counter actually did.
     */
    public function pending(): JsonResponse
    {
        $failed = ReceiptPrint::query()
            ->with(['sale:id,invoice_number,total,sold_at', 'user:id,name'])
            ->where('status', ReceiptPrint::FAILED)
            // "Later" is COPY NUMBER, not clock time.
            //
            // `printed_at` is a second-precision timestamp, and a reprint that
            // follows a failure inside the same second — a till retrying, a
            // fallback to the second printer — ties rather than exceeds it. The
            // `>` then never matched, so the receipt stayed in the tray after it
            // had come out, for ever. A tray that never empties buries the one
            // receipt that really is missing under fifty that were sorted out
            // hours ago.
            //
            // `copy_no` is the sequence itself: monotonic, per sale, assigned by
            // `nextCopyNo`, and with no precision to lose. The subquery is
            // already scoped to one sale, which is exactly where copy_no counts.
            ->whereNotExists(function ($q): void {
                $q->selectRaw(1)
                    ->from('receipt_prints as later')
                    ->whereColumn('later.sale_id', 'receipt_prints.sale_id')
                    ->whereColumn('later.copy_no', '>', 'receipt_prints.copy_no')
                    ->where('later.status', ReceiptPrint::PRINTED);
            })
            ->orderByDesc('printed_at')
            ->limit(50)
            ->get();

        return ApiResponse::ok($failed);
    }

    /**
     * Reprint counts per cashier for a date range — the control that makes
     * logging copies worth anything. A cashier who reprints ten times as often
     * as the rest of the counter is the finding.
     */
    public function reprintReport(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from' => ['sometimes', 'nullable', 'date'],
            'to' => ['sometimes', 'nullable', 'date'],
        ]);

        $from = isset($data['from']) ? Carbon::parse($data['from'])->startOfDay() : now()->startOfMonth();
        $to = isset($data['to']) ? Carbon::parse($data['to'])->endOfDay() : now()->endOfDay();

        $rows = ReceiptPrint::query()
            ->selectRaw('user_id, kind, count(*) as total')
            ->whereBetween('printed_at', [$from, $to])
            ->groupBy('user_id', 'kind')
            ->get();

        $names = User::query()
            ->whereIn('id', $rows->pluck('user_id')->filter()->unique())
            ->pluck('name', 'id');

        $byUser = [];
        foreach ($rows as $row) {
            $key = $row->user_id ?? 'unknown';
            $byUser[$key] ??= [
                'user_id' => $row->user_id,
                'user_name' => $row->user_id === null ? 'Unknown' : ($names[$row->user_id] ?? 'Removed user'),
                'original' => 0, 'reprint' => 0, 'gift' => 0,
            ];
            $byUser[$key][$row->kind] = (int) $row->total;
        }

        return ApiResponse::ok([
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'rows' => array_values($byUser),
        ]);
    }

    /** Who rang this sale. Falls back to the id's absence, never to a guess. */
    private function cashierName(Sale $sale): ?string
    {
        if ($sale->created_by === null) {
            return null;
        }

        return User::query()->whereKey($sale->created_by)->value('name');
    }
}
