---
name: shopos-modules-on-off
description: "PARKED (do after C19/C20): give every shop only the modules it uses — section-wise assign/unassign UI, basic set by default, dependants auto-on"
metadata:
  type: project
---

Asked 2026-09-02, to be designed and built **after** the work in flight (C19, C20).
The complaint: one shop currently shows **everything** — disposals, bank
accounts, and many screens that do not link to anything that shop does — and the
clutter itself is the problem. A small café that only does takeaway (slip to the
kitchen, receipt to the customer, maybe a few tables) should not be handed a
whole warehouse.

**Half of this already exists — do not rebuild it.** `app/Support/Modules.php` is
already a registry of 11 keys with `label`, `description`, `group`
(Selling / Back office / Online / Trade-specific) and `depends`; `normalize()`
already settles the dependency graph downward and already forces `images` on
when `marketplace` is on — the exact example asked for. `defaultsFor($type)`
already proposes a per-trade set on the create-tenant screen. The nav already
reads three axes (MODULE / TRADE / PERMISSION) and already has an
Essential-vs-Full view switch.

**What is actually missing** is granularity and a real assign/unassign screen:
- The registry is **coarse**: 11 keys against **53 shop nav paths**, 30 of which
  ask `has(...)`. Disposals rides on `inventory`; bank accounts ride on
  `expenses`. So the very screens named in the complaint have **no key to turn
  off**. Decide per screen whether it earns its own key or a sub-toggle.
- Dependencies only ever cascade **off**. The ask includes turning dependants
  **on** together ("jo depend krty wo default py on hojayen") — that is a second,
  upward rule, and it must not silently re-enable something an admin turned off.
- The admin side has module editing on tenant create/detail, but not a
  **section-wise** picker with the groups, the descriptions and the dependency
  arrows shown. Tenant side has no view of what it has and has not got.

**Constraints the user set:** nothing may break; the UI must be good; basic
modules on by default for any shop.

**Open question to answer first:** does a module toggle hide a screen only, or
also refuse its API? Today `featureEnabled()` does both in places (`MODULE_DISABLED`),
and [[shopos-job-offered-must-be-doable]] is the standing scar from getting that
half-right — a job was offered whose every screen bounced.

Related: [[shopos-images-and-riders]] (online ⇒ images compulsory),
[[shopos-plans-and-flow]] (a plan is payment only — modules belong to the tenant,
never to the plan), [[shopos-no-roles]], [[shopos-menu-and-door]].
