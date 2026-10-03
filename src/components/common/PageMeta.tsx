import { HelmetProvider, Helmet } from "react-helmet-async";
import { PRODUCT } from "../../common/brand";

/**
 * A page's title and description, and the one place the product's name is
 * appended to a title.
 *
 * ── Why the suffix moved in here ─────────────────────────────────────
 *
 * Every caller used to write it — the product's name, inside the page's own
 * title string — seventy-three times. That is seventy-three chances to spell it differently, to
 * forget it, or to be the one page left behind by a rename — and the rename
 * happened, so two of the three clients were shipping a different product
 * name at the same time.
 *
 * A page knows what IT is. It does not know, and should not have to restate,
 * what application it is part of. `brandName.test.ts` fails on any file under
 * `src` that writes the name out, so this cannot quietly go back.
 *
 * ── The separator is here too ────────────────────────────────────────
 *
 * Not because " | " is interesting, but because it was already inconsistent
 * in the places that built the string by hand, and a tab strip where some
 * titles use a pipe and others a dash reads as two applications.
 */
const PageMeta = ({
  title,
  description,
  area,
}: {
  /** THE PAGE's title — "Customers". The product's name is added here. */
  title: string;
  description: string;
  /**
   * Which part of the product this page belongs to — "Admin", today.
   *
   * The platform console's tabs used to read "Tenants | True Serve Admin",
   * and that distinction is real: somebody with both open needs to know which
   * window manages ONE shop and which manages all of them. So the suffix is
   * still two words, but only the second one is written here — the product's
   * half comes from the same constant every other page uses.
   */
  area?: string;
}) => (
  <Helmet>
    <title>{`${title} | ${PRODUCT.name}${area ? ` ${area}` : ""}`}</title>
    <meta name="description" content={description} />
  </Helmet>
);

export const AppWrapper = ({ children }: { children: React.ReactNode }) => (
  <HelmetProvider>{children}</HelmetProvider>
);

export default PageMeta;
