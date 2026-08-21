---
name: shopos-everyone-minus-one-role
description: FIXED — the announcement audience labelled "Everyone" resolved to owners+customers with UserRole::Staff in no branch; the cashier's bell existed and could never be filled
metadata:
  type: project
---

`SendAnnouncement::recipients` had `'all' => [ShopOwner, Customer]`.
`UserRole::Staff` appeared in **no** branch. The admin's dropdown labels that
option **"Everyone"**; the migration promises "all tenant owners, all customers,
or everyone".

So "Scheduled maintenance Sunday 2am — the till will be offline" reached every
shop owner and not one cashier. The people the message is *about* were the only
role it could not reach — and staff ARE addressable: `/notifications` sits behind
no role gate and the bell renders for every signed-in role. There was a bell, and
nothing could ever be put in it.

**Why `tenants` was NOT widened:** it is labelled "All shops" (now **"Shop
owners"**) and resolves to owners only. Widening both would have fixed one label
by deleting the admin's only way to write to owners alone about billing. Fixing
the label preserves the capability; the test
`test_shop_owners_audience_deliberately_excludes_staff` exists to protect that
decision, not to catch a mistake.

**How to apply:** the picker now reads its options from the same `AUDIENCE_LABEL`
map as the list badge — they had already drifted. One map, three readers.

Still open and raised rather than decided: `notifyTenantOwners` filters to owners
by construction, so tenant staff receive **no operational notification of any
kind**. Whether a cashier should hear about low stock is the shop's call.

Related: [[shopos-no-roles]], [[shopos-read-vs-manage]].
