<?php

namespace App\Models\Concerns;

use App\Models\User;
use App\Support\Permissions;

/**
 * Strips what the shop OWES and PAID its suppliers from the payload of anyone
 * who neither buys, pays nor reads the books.
 *
 * The stockroom reads a supplier and an order to take a delivery in — the
 * lines, the quantities, the cost on each (it types what the delivery cost).
 * The balance, the order's total and what was paid against it are a debt, and
 * the owner (2026-10-14, Q9) does not want them on every stock keeper's,
 * pharmacist's and forecourt attendant's screen: tester pass 2 found 29,400
 * owed in their answers.
 *
 * On the MODEL, like HidesCostPrice, because a supplier is serialised inside
 * every order and an order inside every supplier.
 */
trait HidesSupplierMoney
{
    public function toArray(): array
    {
        $data = parent::toArray();
        $user = auth()->user();

        if ($user instanceof User && ! $user->hasAnyPermission(Permissions::SEES_SUPPLIER_MONEY)) {
            foreach ($this->supplierMoneyKeys() as $key) {
                unset($data[$key]);
            }
        }

        return $data;
    }

    /** @return list<string> */
    abstract protected function supplierMoneyKeys(): array;
}
