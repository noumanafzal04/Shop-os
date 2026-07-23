<?php

namespace App\Enums;

enum UserRole: string
{
    case SuperAdmin = 'super_admin';
    case AdminStaff = 'admin_staff';
    case ShopOwner = 'shop_owner';
    case Staff = 'staff';
    case Customer = 'customer';

    /**
     * Roles that operate inside a tenant context.
     */
    public function requiresTenant(): bool
    {
        return in_array($this, [self::ShopOwner, self::Staff], strict: true);
    }

    /**
     * Roles that operate on the platform (admin) side.
     */
    public function isPlatform(): bool
    {
        return in_array($this, [self::SuperAdmin, self::AdminStaff], strict: true);
    }
}
