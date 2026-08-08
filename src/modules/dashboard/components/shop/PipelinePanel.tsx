import { Fragment } from "react";

import { PlugInIcon } from "../../../../icons";
import type { OrderPipeline } from "../../types";
import { EmptyPanel, SectionCard } from "./SectionCard";

type Tone = "warning" | "brand" | "success" | "gray";

/** A stage with work in it is filled; an empty stage is only outlined. */
const STAGE: Record<Tone, string> = {
  warning: "border-warning-500 bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-500",
  brand: "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400",
  success: "border-success-500 bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500",
  gray: "border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-transparent dark:text-gray-400",
};

interface Props {
  pipeline: OrderPipeline;
  /** Only the marketplace module has an Orders screen to open. */
  to?: string;
}

/** Where every open order stands right now, left to right. */
export function PipelinePanel({ pipeline, to }: Props) {
  const stages: Array<{ label: string; value: number; tone: Tone }> = [
    { label: "Pending", value: pipeline.pending, tone: pipeline.pending > 0 ? "warning" : "gray" },
    { label: "Preparing", value: pipeline.preparing, tone: pipeline.preparing > 0 ? "brand" : "gray" },
    { label: "Out for delivery", value: pipeline.delivery, tone: pipeline.delivery > 0 ? "brand" : "gray" },
    { label: "Completed", value: pipeline.completed, tone: pipeline.completed > 0 ? "success" : "gray" },
  ];

  const empty = stages.every((s) => s.value === 0);

  return (
    <SectionCard
      title="Order pipeline"
      subtitle="All online & delivery orders"
      icon={<PlugInIcon className="size-5" />}
      to={to}
      toLabel="View Orders"
    >
      {empty ? (
        <EmptyPanel
          message="No orders have come in yet."
          hint="Each one moves through these four stages."
        />
      ) : (
        <div className="flex items-start">
          {stages.map((stage, i) => (
            <Fragment key={stage.label}>
              <div className="flex w-20 shrink-0 flex-col items-center gap-2 sm:w-24">
                <span
                  className={`flex size-14 items-center justify-center rounded-full border-2 text-theme-sm font-bold tabular-nums shadow-theme-xs ${STAGE[stage.tone]}`}
                >
                  {stage.value}
                </span>
                <span
                  className={`text-center text-theme-xs ${
                    stage.value > 0
                      ? "font-medium text-gray-700 dark:text-gray-200"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {stage.label}
                </span>
              </div>
              {i < stages.length - 1 && (
                <span className="mt-7 h-0.5 flex-1 rounded-full bg-gradient-to-r from-gray-200 to-gray-100 dark:from-gray-700 dark:to-gray-800" />
              )}
            </Fragment>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
