import Alert from "../../../components/ui/alert/Alert";

/**
 * "It is saved — and here is what to know about it."
 *
 * Shown at the head of an expense or income form once its entry has been
 * recorded with something to say about it. The form under it is locked and
 * the only button is Done: see savedNotes for why neither a held-open live
 * form nor a toast was the right place for this.
 */
export function SavedNotice({ saved, notes }: { saved: string; notes: string[] }) {
  if (notes.length === 0) return null;

  return (
    <div className="mb-4 space-y-3" data-testid="saved-notice" role="status">
      <Alert variant="success" title={saved} message="Nothing more to do here — read the note below, then press Done." />
      {notes.map((note, i) => (
        <Alert key={i} variant="warning" title="Worth knowing" message={note} />
      ))}
    </div>
  );
}
