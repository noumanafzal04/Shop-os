<?php

use App\Models\Branch;
use App\Models\Product;
use App\Models\ProductVariant;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Eighty-sixing belonged to the SHOP. So a chain with two kitchens had one
 * switch between them: Gulberg ran out of pizza bases, the chef took the pizza
 * off, and DHA — with a full tray of bases — stopped selling it too.
 *
 * A kitchen runs out. A chain does not. This is the same argument that made 86
 * per-SIZE a week ago, one dimension further out: a size is what a customer
 * orders, and a branch is where the thing physically is not.
 *
 * ── One source of truth, deliberately ───────────────────────────────────
 *
 * The obvious cheap move is to keep `products.sold_out_at` as "off everywhere"
 * and add per-branch rows beside it. That is two places holding one fact, and
 * this codebase has paid for that shape repeatedly — the copy that drifts is
 * always the one written by somebody else on another day.
 *
 * So the columns go, and every flag they held is written out as a row PER
 * BRANCH: a shop that had something off stays exactly as it was, at every
 * branch it has, and nothing silently comes back on sale during a deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('branch_sold_out', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            // Null = the whole item is off here. Set = only this size is.
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->cascadeOnDelete();
            $table->timestamp('sold_out_at');
            $table->foreignUuid('sold_out_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            // One answer per thing per branch. A second press must not be able
            // to write a second row and make "is it off?" depend on which one
            // a query happened to read first.
            $table->unique(['branch_id', 'product_id', 'variant_id'], 'branch_sold_out_unique');
            $table->index(['tenant_id', 'branch_id']);
        });

        $this->carryTheExistingFlagsOver();

        // The INDEX first. A column dropped while an index still names it is
        // refused outright by sqlite and silently survives on MySQL — the exact
        // shape the CI gate that runs migrations back DOWN was written to catch,
        // and it caught this one before it left the machine.
        Schema::table('products', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'sold_out_at']);
            $table->dropConstrainedForeignId('sold_out_by');
            $table->dropColumn('sold_out_at');
        });
        Schema::table('product_variants', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('sold_out_by');
            $table->dropColumn('sold_out_at');
        });
    }

    /**
     * Everything a shop had taken off stays off — at every branch it owns.
     *
     * Reading the wider way round would be worse: leaving a shop's flags behind
     * puts a dish back on the menu that the kitchen has none of, in the middle
     * of a service nobody is watching a migration during.
     */
    private function carryTheExistingFlagsOver(): void
    {
        $branchesByTenant = Branch::withoutTenancy()->get()->groupBy('tenant_id');
        $rows = [];

        $add = function (string $tenantId, ?string $productId, ?string $variantId, $at, $by) use ($branchesByTenant, &$rows): void {
            foreach ($branchesByTenant->get($tenantId, collect()) as $branch) {
                $rows[] = [
                    'id' => (string) Str::uuid7(),
                    'tenant_id' => $tenantId,
                    'branch_id' => $branch->id,
                    'product_id' => $productId,
                    'variant_id' => $variantId,
                    'sold_out_at' => $at,
                    'sold_out_by' => $by,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }
        };

        foreach (Product::withoutTenancy()->whereNotNull('sold_out_at')->get() as $p) {
            $add($p->tenant_id, $p->id, null, $p->sold_out_at, $p->sold_out_by);
        }

        foreach (ProductVariant::withoutTenancy()->whereNotNull('sold_out_at')->with('product')->get() as $v) {
            if ($v->product === null) {
                continue;
            }
            $add($v->product->tenant_id, $v->product_id, $v->id, $v->sold_out_at, $v->sold_out_by);
        }

        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table('branch_sold_out')->insert($chunk);
        }
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            $table->timestamp('sold_out_at')->nullable();
            $table->foreignUuid('sold_out_by')->nullable()->constrained('users')->nullOnDelete();
            $table->index(['tenant_id', 'sold_out_at']);
        });
        Schema::table('product_variants', function (Blueprint $table): void {
            $table->timestamp('sold_out_at')->nullable();
            $table->foreignUuid('sold_out_by')->nullable()->constrained('users')->nullOnDelete();
        });

        // Coming back down, a thing is off if ANY branch had it off — the
        // reading that cannot put something on sale that a kitchen has none of.
        foreach (DB::table('branch_sold_out')->get() as $row) {
            $target = $row->variant_id === null
                ? DB::table('products')->where('id', $row->product_id)
                : DB::table('product_variants')->where('id', $row->variant_id);
            $target->update(['sold_out_at' => $row->sold_out_at, 'sold_out_by' => $row->sold_out_by]);
        }

        Schema::dropIfExists('branch_sold_out');
    }
};
