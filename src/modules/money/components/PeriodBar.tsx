import React from "react";
import { ChipBar } from "@cartze/core/ui/ChipBar";
import type { Period } from "../services/moneyService";

/**
 * WHICH STRETCH OF TIME THE FIGURES COVER.
 *
 * `tax_year` is Pakistan's — 1 July to 30 June — and it is offered beside the
 * calendar year rather than instead of it, because a shopkeeper asks both
 * questions and they have different answers. It is not a setting: a shop does
 * not choose which tax year the FBR uses.
 *
 * The pills are `ChipBar` — see the note there on why they are shared.
 */
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "daily", label: "Today" },
  { key: "weekly", label: "This week" },
  { key: "monthly", label: "This month" },
  { key: "yearly", label: "This year" },
  { key: "tax_year", label: "Tax year" },
];

/**
 * The fixed periods, then "Custom dates" — which opens the range sheet and,
 * once a range is chosen, wears it as its label ("12 Nov – 20 Nov").
 */
export function PeriodBar({
  active,
  onPick,
  customLabel,
}: {
  active: Period;
  onPick: (p: Period) => void;
  customLabel?: string | null;
}) {
  const items = [...PERIODS, { key: "custom" as Period, label: customLabel ?? "Custom dates" }];
  return <ChipBar items={items} active={active} onPick={onPick} />;
}
