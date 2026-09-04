import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import Button from "../../../components/ui/button/Button";
import { Modal } from "../../../components/ui/modal";
import { useToast } from "../../../components/ui/toast";
import { dipChartToText, parseDipChart } from "../dipChartText";
import { fuelService, type FuelTank } from "../services/fuelService";

/**
 * A TANK'S CALIBRATION CHART.
 *
 * The forecourt shipped asking for a closing dip in litres, and a dipstick does
 * not read in litres. An underground cylinder holds a wildly different volume
 * per millimetre at the bottom, the middle and the crown, so the operator was
 * doing the lookup by hand off a paper chart, in the dark, at the end of a
 * shift — into the one number the whole leak detection rests on.
 *
 * ── Why it is a textarea and not a form ─────────────────────────────────
 *
 * Because a station HAS the chart already: a certificate, a spreadsheet, a
 * twenty-year-old manufacturer's table, anywhere from twenty rows to two
 * thousand. Asking somebody to key two thousand pairs into a grid is asking
 * them not to load it at all, and a tank with no chart sends the operator back
 * to the torch. Paste is the only interface that meets the shop where it is.
 *
 * ── Why the rejected lines are named ────────────────────────────────────
 *
 * A parser that silently drops what it did not understand produces a chart
 * that looks complete and is short a hundred rows, and the tank is then
 * measured against a table with a hole in it. Every line that was not two
 * numbers is listed with its line number, so the paste can be fixed rather
 * than trusted.
 */
export function DipChartModal({ tank, isOpen, onClose }: {
  tank: FuelTank | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState("");

  const existing = useQuery({
    queryKey: ["fuel", "dip-chart", tank?.id],
    queryFn: async () => (await fuelService.dipChart(tank!.id)).data,
    enabled: isOpen && tank !== null,
  });

  // Loaded into the box so a chart can be CORRECTED rather than re-pasted —
  // one wrong line in two thousand should not mean finding the original again.
  useEffect(() => {
    if (existing.data) setText(dipChartToText(existing.data.points));
  }, [existing.data]);

  const parsed = parseDipChart(text);

  const save = useMutation({
    mutationFn: () => fuelService.replaceDipChart(tank!.id, parsed.points),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["fuel"] });
      toast.success(
        parsed.points.length === 0
          ? "Chart cleared — this tank is dipped in litres again."
          : `Chart saved — ${parsed.points.length} depths.`,
      );
      onClose();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save the chart"),
  });

  if (tank === null) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg">
      <div className="p-6">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Calibration chart — {tank.name}
        </h3>
        <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
          Paste the chart that came with this tank: the depth in millimetres, then the litres it
          holds at that depth. Two columns, in whatever your table uses to separate them.
        </p>
        <p className="mt-1 text-theme-xs text-gray-400">
          Once it is here, the close screen takes a stick reading and works the litres out itself.
        </p>

        <textarea
          className="mt-4 h-56 w-full rounded-xl border border-gray-300 bg-transparent px-3 py-2 font-mono text-theme-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"mm\tlitres\n0\t0\n100\t640\n200\t1780\n…"}
          spellCheck={false}
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-theme-xs">
          <span className="text-gray-500 dark:text-gray-400">
            {parsed.points.length === 0
              ? "Nothing to save yet — an empty box clears the chart."
              : `${parsed.points.length} depths, ${parsed.points[0].mm}mm to ${parsed.points[parsed.points.length - 1].mm}mm.`}
          </span>
          {parsed.points.length === 1 && (
            <span className="font-medium text-warning-600 dark:text-warning-400">
              One depth is not a chart — nothing can be read between it.
            </span>
          )}
        </div>

        {parsed.rejected.length > 0 && (
          <div className="mt-3 rounded-xl border border-warning-300 bg-warning-50 px-3 py-2 dark:border-warning-500/30 dark:bg-warning-500/10">
            <p className="text-theme-xs font-semibold text-warning-700 dark:text-warning-400">
              {parsed.rejected.length} line{parsed.rejected.length === 1 ? "" : "s"} could not be read
              as two numbers and {parsed.rejected.length === 1 ? "is" : "are"} not in the chart:
            </p>
            <ul className="mt-1 space-y-0.5 text-theme-xs text-warning-700/80 dark:text-warning-400/80">
              {parsed.rejected.slice(0, 6).map((r) => (
                <li key={r.line} className="font-mono">line {r.line}: {r.text.slice(0, 60)}</li>
              ))}
              {parsed.rejected.length > 6 && <li>…and {parsed.rejected.length - 6} more.</li>}
            </ul>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={save.isPending || parsed.points.length === 1}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : parsed.points.length === 0 ? "Clear chart" : "Save chart"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
