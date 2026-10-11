import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Alert from "../../../components/ui/alert/Alert";
import Button from "../../../components/ui/button/Button";
import Select from "../../../components/form/Select";
import { Modal } from "../../../components/ui/modal";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { branchService, type Branch, type PlaceGoing } from "../services/branchService";
import { byKind, isWarehouse, kindWord } from "../places";
import { going, stockSays, unanswered, type Answers } from "../placeGoing";

/**
 * DELETING A PLACE — and deciding, here, what becomes of what is in it.
 *
 * It used to be a yes/no. A place holding stock was then refused, and the
 * owner was left to raise a transfer by hand, move each person on the Staff
 * screen, and come back to press Delete again.
 *
 * So the dialog first ASKS the server what is there, and then asks the owner
 * only the questions that has raised:
 *
 *   its stock    move it to another place — or do not, and write it off
 *   its people   where they work from now on
 *
 * What a person has to finish first — an open till, a table, a van on the
 * road — is not offered as a choice: it is said, and Delete stays off.
 *
 * What happened at the place is never part of the question. Its sales,
 * expenses and stock movements stay in the books, and the dialog says so
 * before anything else, because that is what an owner is afraid of losing.
 */
export function DeletePlaceDialog({
  place,
  places,
  pending,
  onCancel,
  onDelete,
}: {
  /** The place being deleted; null closes the dialog. */
  place: Branch | null;
  /** Every place of the business, to choose a destination from. */
  places: readonly Branch[];
  pending: boolean;
  onCancel: () => void;
  onDelete: (going: PlaceGoing) => void;
}) {
  const [answers, setAnswers] = useState<Answers>({ stock: "", stockTo: "", peopleTo: "" });
  // A fresh set of answers for each place: one place's "write it off" must
  // never be standing ready when the next dialog opens.
  useEffect(() => { setAnswers({ stock: "", stockTo: "", peopleTo: "" }); }, [place?.id]);

  const leaving = useQuery({
    queryKey: ["branch-leaving", place?.id],
    queryFn: async () => (await branchService.leaving(place!.id)).data,
    enabled: place !== null,
    // Always asked afresh: stock sold a minute ago changes the answer.
    staleTime: 0,
    gcTime: 0,
  });

  if (place === null) return null;

  const word = kindWord(place.kind);
  const { shops, warehouses } = byKind(places.filter((b) => b.is_active && b.id !== place.id));
  const others = [...shops, ...warehouses].map((b) => ({ value: b.id, label: isWarehouse(b) ? `${b.name} — warehouse` : b.name }));
  const there = leaving.data;
  const waitingOn = there ? unanswered(there, answers) : null;

  const choice = (value: "move" | "discard", title: string, about: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={answers.stock === value}
      onClick={() => setAnswers((a) => ({ ...a, stock: value }))}
      className={`w-full rounded-xl border px-4 py-3 text-left transition ${
        answers.stock === value
          ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
          : "border-gray-200 hover:border-gray-300 dark:border-gray-800"
      }`}
    >
      <span className="block text-sm font-medium text-gray-800 dark:text-white/90">{title}</span>
      <span className="block text-theme-xs text-gray-500 dark:text-gray-400">{about}</span>
    </button>
  );

  return (
    <Modal isOpen onClose={onCancel} className="max-w-lg p-6">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Delete &ldquo;{place.name}&rdquo;?</h3>
      <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
        The {word} is removed from your lists. Everything that happened there — sales, expenses, stock movements — stays in your books.
      </p>

      <div className="mt-5 space-y-5" data-testid="delete-place">
        {leaving.isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        ) : !there ? (
          <ListEmpty from={leaving} what={`what ${place.name} holds`}>
            <p className="text-theme-sm text-gray-500">Nothing to decide.</p>
          </ListEmpty>
        ) : there.blocked ? (
          <Alert variant="warning" title="Something has to be finished first" message={there.blocked} />
        ) : (
          <>
            {there.products > 0 && (
              <div data-testid="delete-place-stock">
                <p className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
                  It still holds {stockSays(there)}. What becomes of them?
                </p>
                <div role="radiogroup" aria-label="What becomes of its stock" className="space-y-2">
                  {choice("move", "Move it to another place", "Everything on its shelves goes there, as one transfer. Batches keep their numbers and expiry dates.")}
                  {answers.stock === "move" && (
                    <div className="pl-1">
                      <Select
                        aria-label="Move its stock to"
                        options={others}
                        value={answers.stockTo}
                        onChange={(v) => setAnswers((a) => ({ ...a, stockTo: v }))}
                        placeholder="Choose the place it moves to"
                      />
                    </div>
                  )}
                  {choice("discard", "Do not move it — write it off", `It leaves your books with the ${word}. This cannot be undone.`)}
                </div>
              </div>
            )}

            {there.people > 0 && (
              <div data-testid="delete-place-people">
                <p className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
                  {there.people === 1 ? "One person works" : `${there.people} people work`} here. Where will they work?
                </p>
                <Select
                  aria-label="Move its staff to"
                  options={others}
                  value={answers.peopleTo}
                  onChange={(v) => setAnswers((a) => ({ ...a, peopleTo: v }))}
                  placeholder="Choose a place"
                />
              </div>
            )}

            {there.products === 0 && there.people === 0 && (
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">It holds no stock and nobody is assigned to it, so there is nothing else to decide.</p>
            )}
          </>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        {there && !there.blocked && waitingOn && (
          <span className="mr-auto text-theme-xs text-gray-500 dark:text-gray-400" data-testid="delete-place-waiting">{waitingOn}</span>
        )}
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          size="sm"
          variant="danger"
          disabled={pending || !there || waitingOn !== null}
          onClick={() => there && onDelete(going(there, answers))}
        >
          {pending ? "Deleting…" : word === "warehouse" ? "Delete warehouse" : "Delete branch"}
        </Button>
      </div>
    </Modal>
  );
}
