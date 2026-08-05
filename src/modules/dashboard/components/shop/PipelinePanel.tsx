import { Fragment } from "react";

import type { OrderPipeline } from "../../types";
import { EmptyPanel, SectionCard } from "./SectionCard";

type Tone = "warning" | "brand" | "success" | "gray";

const RING: Record<Tone, string> = {
  warning: "border-warning-500 text-warning-600 dark:text-warning-500",
  brand: "border-brand-500 text-brand-600 dark:text-brand-400",
  success: "border-success-500 text-success-600 dark:text-success-500",
  gray: "border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-500",
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
    <SectionCard title="Order pipeline" subtitle="All online & delivery orders" to={to} toLabel="View Orders">
      {empty ? (
        <EmptyPanel message="No orders have come in yet." />
      ) : (
        <div className="flex items-start">
          {stages.map((stage, i) => (
            <Fragment key={stage.label}>
              <div className="flex w-20 shrink-0 flex-col items-center gap-2 sm:w-24">
                <span
                  className={`flex size-12 items-center justify-center rounded-full border-2 bg-white text-theme-sm font-bold tabular-nums dark:bg-transparent ${RING[stage.tone]}`}
                >
                  {stage.value}
                </span>
                <span className="text-center text-theme-xs text-gray-500 dark:text-gray-400">
                  {stage.label}
                </span>
              </div>
              {i < stages.length - 1 && (
                <span className="mt-6 h-px flex-1 bg-gray-200 dark:bg-gray-800" />
              )}
            </Fragment>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
