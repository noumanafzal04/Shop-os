import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

import { apiPost } from "../../../common/api/client";
import { ApiError } from "../../../common/types/api";
import Label from "../../../components/form/Label";
import InputField from "../../../components/form/input/InputField";
import TextArea from "../../../components/form/input/TextArea";
import { TRADE_CART } from "./tradeCarts";
import type { TradeCode } from "./tradeIcon";

const TRADES: TradeCode[] = [
  "food", "mart", "pharmacy", "retail",
  "services", "automotive", "petroleum", "finance",
];

type Kind = "walkthrough" | "question";

/**
 * ASK FOR A PERSON.
 *
 * One tap higher up the page hands out a working shop, and for most visitors
 * that is the better answer — nobody sells a till by making somebody wait for
 * a phone call. This is for the two it does not suit: the shopkeeper who will
 * not touch software until a human has walked them through it, and the one
 * with a single question standing between them and buying. Before this,
 * both of those read the whole page and then left it.
 *
 * ── It does not book anything, and it does not pretend to ──────────────
 *
 * The time is a PREFERENCE. No slot is held and no diary is written to, so the
 * confirmation says a person will write back to confirm it. A form that
 * announced "your demo is booked for Tuesday 4pm" would make the first promise
 * this product ever makes to a stranger one it cannot keep.
 *
 * ── Why almost every field is optional ─────────────────────────────────
 *
 * A name and an email is the whole requirement. Demanding a company name, a
 * city and a trade from somebody who wants to ask one question is how a form
 * gets closed instead of sent.
 */
export function EnquiryForm() {
  const id = useId();
  const [kind, setKind] = useState<Kind>("walkthrough");
  const [form, setForm] = useState({
    name: "", email: "", phone: "", business_name: "",
    business_type: "", city: "", prefers_at: "", message: "",
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((was) => ({ ...was, [key]: value }));

  const send = useMutation({
    mutationFn: () =>
      apiPost<{ id: string; kind: Kind }>("/enquiries", {
        kind,
        name: form.name,
        email: form.email,
        phone: form.phone || null,
        business_name: form.business_name || null,
        business_type: form.business_type || null,
        city: form.city || null,
        // AS AN INSTANT, not as the wall-clock string the picker gives.
        // "2026-09-01T16:00" carries no zone, so the server reads it in its
        // own — and a time a couple of hours away can arrive already in the
        // past, refused by `after:now` for no reason the visitor can see.
        prefers_at:
          kind === "walkthrough" && form.prefers_at
            ? new Date(form.prefers_at).toISOString()
            : null,
        message: form.message || null,
      }),
  });

  // THE FORM REPLACES ITSELF. A toast needs a provider this page does not
  // mount, and a green line above a form still holding their details reads as
  // "did that send?" — this leaves nothing to wonder about.
  if (send.isSuccess) {
    return (
      <div className="settles rounded-3xl border border-success-200 bg-success-50 p-8 text-center dark:border-success-500/25 dark:bg-success-500/10">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-500 text-white">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-6 w-6">
            <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h3 className="mt-5 text-xl font-bold text-gray-900 dark:text-white">
          {kind === "walkthrough" ? "We will confirm a time" : "We have your question"}
        </h3>
        <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          {send.data?.message ?? "Thank you — we will get back to you."} In the
          meantime the demo is still there, and it opens a shop of your own in
          one tap.
        </p>
      </div>
    );
  }

  const problem =
    send.error instanceof ApiError
      ? (send.error.firstFieldError() ?? send.error.message)
      : send.error
        ? "That did not send. Please try again."
        : null;

  return (
    <form
      className="rounded-3xl border border-gray-200 bg-white p-6 shadow-xl shadow-gray-900/5 sm:p-8 dark:border-white/10 dark:bg-gray-900 dark:shadow-black/20"
      onSubmit={(event) => {
        event.preventDefault();
        send.mutate();
      }}
    >
      {/* WHICH OF THE TWO THIS IS. It changes what is asked below — a
          question has no time to arrange — and it changes which queue the
          row lands in, because a question wants answering today and a
          walkthrough wants half an hour next week. */}
      <div
        role="radiogroup"
        aria-label="What would you like?"
        className="grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1.5 dark:bg-white/5"
      >
        {([
          ["walkthrough", "Show me around"],
          ["question", "I have a question"],
        ] as Array<[Kind, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => setKind(value)}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              kind === value
                ? "bg-white text-brand-600 shadow-sm dark:bg-gray-800 dark:text-brand-300"
                : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-name`}>Your name</Label>
          <InputField
            id={`${id}-name`} name="name" value={form.name}
            onChange={(e) => set("name")(e.target.value)}
            placeholder="John Doe" autoComplete="name"
          />
        </div>

        <div>
          <Label htmlFor={`${id}-email`}>Email</Label>
          <InputField
            id={`${id}-email`} name="email" type="email" value={form.email}
            onChange={(e) => set("email")(e.target.value)}
            placeholder="you@example.com" autoComplete="email"
          />
        </div>

        <div>
          <Label htmlFor={`${id}-phone`}>Phone <span className="font-normal text-gray-400">(optional)</span></Label>
          <InputField
            id={`${id}-phone`} name="phone" value={form.phone}
            onChange={(e) => set("phone")(e.target.value)}
            placeholder="0300 1234567" autoComplete="tel"
          />
        </div>

        <div>
          <Label htmlFor={`${id}-shop`}>Shop name <span className="font-normal text-gray-400">(optional)</span></Label>
          <InputField
            id={`${id}-shop`} name="business_name" value={form.business_name}
            onChange={(e) => set("business_name")(e.target.value)}
            placeholder="Al-Saeed Mart"
          />
        </div>

        <div>
          <Label htmlFor={`${id}-trade`}>What kind of shop <span className="font-normal text-gray-400">(optional)</span></Label>
          {/* A plain <select>. The app's own Select is built for forms inside
              the panel and carries its state and portal with it; this is one
              field on a public page and the native control is what a phone
              gives its own picker to. */}
          <select
            id={`${id}-trade`} name="business_type" value={form.business_type}
            onChange={(e) => set("business_type")(e.target.value)}
            className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          >
            <option value="">Choose a trade</option>
            {TRADES.map((code) => (
              <option key={code} value={code}>{TRADE_CART[code].label}</option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor={`${id}-city`}>City <span className="font-normal text-gray-400">(optional)</span></Label>
          <InputField
            id={`${id}-city`} name="city" value={form.city}
            onChange={(e) => set("city")(e.target.value)}
            placeholder="Karachi"
          />
        </div>

        {kind === "walkthrough" && (
          <div className="sm:col-span-2">
            <Label htmlFor={`${id}-when`}>When suits you <span className="font-normal text-gray-400">(optional)</span></Label>
            <InputField
              id={`${id}-when`} name="prefers_at" type="datetime-local" value={form.prefers_at}
              onChange={(e) => set("prefers_at")(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Nothing is booked by this — we will write back to confirm.
            </p>
          </div>
        )}

        <div className="sm:col-span-2">
          <Label htmlFor={`${id}-message`}>
            {kind === "walkthrough" ? "Anything we should know" : "Your question"}
            <span className="font-normal text-gray-400"> (optional)</span>
          </Label>
          <TextArea
            value={form.message}
            onChange={set("message")}
            rows={4}
            placeholder={
              kind === "walkthrough"
                ? "Two branches, one opens at six in the morning."
                : "Does it work if my internet goes for an hour every evening?"
            }
          />
        </div>
      </div>

      {problem && (
        <p role="alert" className="mt-5 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">
          {problem}
        </p>
      )}

      <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row">
        <button
          type="submit"
          disabled={send.isPending}
          className="w-full rounded-xl bg-brand-500 px-7 py-3.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {send.isPending
            ? "Sending…"
            : kind === "walkthrough" ? "Ask for a walkthrough" : "Send the question"}
        </button>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          We reply to the email you leave. Nothing else is done with it.
        </p>
      </div>
    </form>
  );
}
