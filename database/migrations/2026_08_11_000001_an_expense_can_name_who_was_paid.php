<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The one tenant whose whole product is the expense list could not say who it
 * paid.
 *
 * `expenses.supplier_id` exists, is validated, and the list renders a "Paid to"
 * column from it — but every `/suppliers` route rides the inventory module, and
 * a books-only shop has no inventory. So the column was permanently blank and
 * the picker 403'd on page load.
 *
 * Widening the supplier gate was tried and reverted: most trades carry
 * `expenses`, so `inventory OR expenses` opened the vendor directory to
 * everyone and broke six module-isolation tests that exist on purpose.
 *
 * The reason it did not fit is that these are two different things. A SUPPLIER
 * is a stock-chain party — it has payables, purchase orders, a running balance.
 * A landlord is not a supplier; neither is WAPDA, or the man who fixed the
 * shutter. `payee` is what a book records: a name, on a bill, with no
 * relationship behind it. A shop that has both keeps both — the supplier link
 * where it is buying goods, the payee where it is simply paying someone.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('expenses', function (Blueprint $t): void {
            $t->string('payee')->nullable()->after('supplier_id');
        });

        Schema::table('incomes', function (Blueprint $t): void {
            // The other side of the same gap: income could not say who it came
            // FROM either, and "who paid this invoice" is the first question
            // asked of any receipt.
            $t->string('payer')->nullable()->after('income_category_id');
        });
    }

    public function down(): void
    {
        Schema::table('expenses', function (Blueprint $t): void {
            $t->dropColumn('payee');
        });

        Schema::table('incomes', function (Blueprint $t): void {
            $t->dropColumn('payer');
        });
    }
};
