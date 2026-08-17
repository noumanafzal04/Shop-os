import { useState } from "react";

import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import {
  useBanks,
  useDeleteBank,
  useDeleteBankOffer,
  useSaveBank,
  useSaveBankOffer,
} from "../hooks/useBanks";
import type { Bank, BankCardOffer } from "../services/banksService";
import { BankOfferForm } from "../components/BankOfferForm";
import { BankForm } from "../components/BankForm";

/**
 * Banks, and the campaigns they fund on their own cards.
 *
 * ── Why this sits beside Promotions and not in Settings ─────────────────
 *
 * It is the same kind of thing: an offer the shop agrees in advance and the
 * till applies automatically. It also carries the same permission — signing a
 * deal with HBL is marketing, not a settings switch — and putting it in
 * Settings would show a section to everyone holding `settings.manage` and let
 * none of them use it.
 *
 * ── The screen leads with what a shop actually forgets ───────────────────
 *
 * Not "how much" — that is on the contract. What a shop loses money on is a
 * campaign that ENDED and is still being honoured at the counter, and an
 * uncapped percentage nobody pictured on a large sale. Both are called out.
 */

const money = (n: string | number | null) =>
  n === null ? "—" : `Rs ${Number(n).toLocaleString()}`;

/** What an offer is worth, in the words the contract used. */
function terms(offer: BankCardOffer): string {
  const head = offer.type === "percent" ? `${Number(offer.value)}%` : money(offer.value);
  const parts = [head];

  if (offer.min_spend !== null) parts.push(`on ${money(offer.min_spend)}+`);
  if (offer.max_discount !== null) parts.push(`max ${money(offer.max_discount)}`);
  if ((offer.card_types ?? []).length > 0) parts.push(`${offer.card_types!.join("/")} only`);

  return parts.join(" · ");
}

/** Has this campaign's last day already passed? */
function hasEnded(offer: BankCardOffer): boolean {
  return offer.ends_on !== null && new Date(offer.ends_on) < new Date(new Date().toDateString());
}

export default function BankOffersPage() {
  const banks = useBanks();
  const saveBank = useSaveBank();
  const deleteBank = useDeleteBank();
  const saveOffer = useSaveBankOffer();
  const deleteOffer = useDeleteBankOffer();
  const toast = useToast();
  const confirm = useConfirm();

  const [editingBank, setEditingBank] = useState<Bank | null | "new">(null);
  const [editingOffer, setEditingOffer] = useState<BankCardOffer | { bank_id: string } | null>(null);

  const rows = banks.data ?? [];

  /**
   * Neither a bank nor an offer is really deleted: sales already point at them
   * and the claim report reads back months. The message says so, because
   * somebody hesitating over a button that is safer than it sounds is a shop
   * that leaves an ended campaign running at the counter.
   */
  const remove = async (kind: "bank" | "offer", id: string, name: string) => {
    const ok = await confirm({
      title: kind === "bank" ? `Remove ${name}?` : `Remove "${name}"?`,
      message:
        "It stops being offered at the till. Sales that already used it keep their record, and it still appears in Bank claims.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;

    (kind === "bank" ? deleteBank : deleteOffer).mutate(id, {
      onSuccess: () => toast.success(kind === "bank" ? "Bank removed" : "Offer removed"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "That could not be removed."),
    });
  };

  return (
    <div>
      <PageMeta title="Bank card offers | ShopOS" description="Banks that fund a discount on their own cards" />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white/90">Bank card offers</h1>
          <p className="mt-1 max-w-2xl text-theme-sm text-gray-500 dark:text-gray-400">
            When a bank runs a deal on its own cards, the customer pays less and{" "}
            <strong>the bank pays you the difference</strong>. Set the deal up here, pick the bank at
            the till, and claim it back from <em>Reports → Bank claims</em>.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditingBank("new")}>Add bank</Button>
      </div>

      {banks.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400">No banks yet.</p>
          <p className="mx-auto mt-1 max-w-md text-theme-xs text-gray-400">
            Add one only when you have actually agreed a deal — the till offers a bank to the
            cashier only while one of its campaigns is running.
          </p>
          <Button size="sm" className="mt-3" onClick={() => setEditingBank("new")}>Add bank</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((bank) => {
            const offers = bank.offers ?? [];
            // A bank the till will actually offer today. Everything else on
            // this card is admin; this is the state a cashier meets.
            const live = offers.filter((o) => o.is_active && !hasEnded(o)).length;

            return (
              <div
                key={bank.id}
                className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
              >
                {/* Tinted band, so a bank reads as a SECTION rather than the
                    first paragraph of a page of identical white. Three
                    banks stacked in plain white cards is the "screen looks
                    blank" report: nothing tells the eye where one ends. */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-white/[0.02]">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-gray-800 dark:text-white/90">{bank.name}</h2>
                    {bank.short_code && (
                      <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] text-gray-500 ring-1 ring-inset ring-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700">
                        {bank.short_code}
                      </span>
                    )}
                    {!bank.is_active ? (
                      <Badge color="light">Switched off</Badge>
                    ) : live > 0 ? (
                      <Badge color="success">{live} running</Badge>
                    ) : null}
                  </div>

                  {/* Three weights, three meanings. They were one grey. */}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditingOffer({ bank_id: bank.id })}>
                      Add offer
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingBank(bank)}>Edit</Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => remove("bank", bank.id, bank.name)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                <div className="p-4">
                {offers.length === 0 ? (
                  <p className="text-theme-xs text-gray-400">
                    No campaigns. The till will not offer this bank until one is running.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {offers.map((offer) => {
                      const ended = hasEnded(offer);
                      const running = offer.is_active && !ended;

                      return (
                        <div
                          key={offer.id}
                          /* The stripe is the campaign's state, read before a
                             word of it. A shop scanning for "what is live
                             right now" should not have to read four badges. */
                          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 border-l-4 px-3 py-2.5 dark:border-gray-800 ${
                            running
                              ? "border-l-success-500"
                              : offer.is_active && ended
                                ? "border-l-warning-500"
                                : "border-l-gray-300 dark:border-l-gray-700"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-gray-800 dark:text-white/90">{offer.label}</span>
                              {!offer.is_active && <Badge color="light">Off</Badge>}
                              {/* The two things a shop actually loses money on. */}
                              {offer.is_active && ended && (
                                <Badge color="warning">Ended — still switched on</Badge>
                              )}
                              {offer.type === "percent" && offer.max_discount === null && (
                                <Badge color="warning">No cap</Badge>
                              )}
                            </div>
                            <p className="text-theme-xs text-gray-500 dark:text-gray-400">{terms(offer)}</p>
                          </div>

                          {/* What the bank pays, as a FIGURE.
                              It was buried mid-sentence in the grey terms line
                              — the one number on the row a shop is looking
                              for, set in the same weight as "Visa only". */}
                          <div className="ml-auto shrink-0 text-right">
                            <div className="text-lg font-bold tabular-nums leading-none text-brand-500">
                              {offer.type === "percent" ? `${Number(offer.value)}%` : money(offer.value)}
                            </div>
                            <div className="mt-0.5 text-[11px] text-gray-400">
                              {offer.max_discount !== null ? `up to ${money(offer.max_discount)}` : "no cap"}
                            </div>
                          </div>

                          <div className="flex shrink-0 gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setEditingOffer(offer)}>Edit</Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => remove("offer", offer.id, offer.label)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingBank !== null && (
        <BankForm
          bank={editingBank === "new" ? null : editingBank}
          saving={saveBank.isPending}
          onClose={() => setEditingBank(null)}
          onSave={(payload) =>
            saveBank.mutate(payload, {
              onSuccess: () => {
                toast.success(payload.id ? "Bank updated" : "Bank added");
                setEditingBank(null);
              },
              onError: (e) => toast.error(e instanceof Error ? e.message : "That could not be saved."),
            })
          }
        />
      )}

      {editingOffer !== null && (
        <BankOfferForm
          offer={"id" in editingOffer ? editingOffer : null}
          bankId={editingOffer.bank_id}
          saving={saveOffer.isPending}
          onClose={() => setEditingOffer(null)}
          onSave={(payload) =>
            saveOffer.mutate(payload, {
              onSuccess: () => {
                toast.success(payload.id ? "Offer updated" : "Offer added");
                setEditingOffer(null);
              },
              onError: (e) => toast.error(e instanceof Error ? e.message : "That could not be saved."),
            })
          }
        />
      )}
    </div>
  );
}
