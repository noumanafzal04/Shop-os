import PageMeta from "../../../components/common/PageMeta";

/**
 * A screen that exists so the shape of the module can be seen, and says so.
 *
 * ── Why this is not an empty page ───────────────────────────────────────
 *
 * This repo has shipped comment-only stubs before, and the lesson was that a
 * blank screen does not read as "not built yet" — it reads as broken, and the
 * shopkeeper goes looking for the computer that works. So each of these names
 * what it WILL do and states plainly that it does not do it yet.
 *
 * Nothing here talks to the API. When a screen is built it replaces its own
 * file; this component is deleted when the last one goes.
 */
export default function NotBuiltYet({
  title,
  lead,
  willDo,
}: {
  title: string;
  lead: string;
  willDo: string[];
}) {
  return (
    <>
      <PageMeta title={`${title} | True Serve`} description={lead} />

      <div className="mb-5">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{lead}</p>
      </div>

      <section className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 dark:border-gray-700 dark:bg-white/[0.03]">
        <span className="inline-block rounded-full bg-brand-50 px-2.5 py-0.5 text-theme-xs font-medium uppercase tracking-wide text-brand-700 dark:bg-brand-500/15 dark:text-brand-400">
          Not built yet
        </span>

        <p className="mt-3 max-w-xl text-sm text-gray-600 dark:text-gray-300">
          This screen is part of Basic HR and is still being built. It is shown here so the
          module&rsquo;s shape can be reviewed — nothing on it is saved or read.
        </p>

        <ul className="mt-4 max-w-xl space-y-1.5">
          {willDo.map((line) => (
            <li key={line} className="flex gap-2 text-sm text-gray-600 dark:text-gray-300">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600" />
              {line}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
