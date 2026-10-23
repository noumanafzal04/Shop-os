import { useLocation } from "react-router";
import Alert from "../../components/ui/alert/Alert";
import { refusedFrom, refusedWords } from "./refused";
import { screenNameOf } from "../../layout/screenNames";
import { usePrimaryBusinessType } from "../tenant/businessType";

/** Said on the screen a gate sent somebody to — see refused.ts. */
export function RefusedNotice() {
  const refused = refusedFrom(useLocation().state);
  const trade = usePrimaryBusinessType();
  if (refused === null) return null;

  const { title, message } = refusedWords(refused, (path) => screenNameOf(path, trade));

  return (
    <div data-testid="refused-notice" role="status" className="mb-4">
      <Alert variant="warning" title={title} message={message} />
    </div>
  );
}
