import { DollarLineIcon } from "../../../../icons";
import type { TenantDashboard } from "../../types";
import type { Capabilities } from "./capabilities";
import { SectionCard } from "./SectionCard";
import { StatTile } from "./StatTile";
import { tileGrid, type Tone } from "./tone";

interface Props {
  data: TenantDashboard;
  caps: Capabilities;
  money: (n: number) => string;
}

/** The page needs this to decide whether to draw the row at all. */
export function hasMoneyPanel(data: TenantDashboard, caps: Capabilities): boolean {
  const { receivable, payable } = data.money_owed;
  return (caps.keepsCustomers && caps.visit("/tenant/customers") && receivable.accounts > 0)
    || (caps.buysFromSuppliers && caps.visit("/tenant/suppliers") && payable.accounts > 0)
    || (caps.pos && data.till !== null && caps.visit("/tenant/day"));
}

/**
 * The shop's cash position right now.
 *
 * Straight after "what did I take today" comes "who owes me" and "who am I
 * about to owe" — both already recorded, neither ever shown anywhere a
 * shopkeeper looks daily. The till tiles sit beside them because banking is the
 * same question one step later: the takings are not really takings until
 * they're somewhere safe.
 *
 * Who sees which tile follows who may open the screen behind it. In practice
 * that means the shop's total khata and its supplier dues are the owner's
 * figures — a cashier needs ONE customer's balance, which the till already
 * gives them, not the shop's whole position. The day and the banking stay,
 * because that is the cashier's own drawer.
 */
export function MoneyPanel({ data, caps, money }: Props) {
  const { receivable, payable } = data.money_owed;
  // A till the person cannot open is a till they are told nothing about.
  // TWO AXES, and only one used to be asked. `visit` is the PERSON — may this
  // cashier open the day screen. `caps.pos` is the SHOP — Day & banking is
  // gated on the till module, so a books-only business reading a `till` block
  // it should never have been sent was offered the card, its two tiles and its
  // "Open Day" header link into a screen its own router refuses. One place,
  // because the header used this and the tiles used something else.
  const till = caps.pos && caps.visit("/tenant/day") ? data.till : null;

  const tiles: Array<{
    key: string;
    label: string;
    value: string;
    caption: string;
    tone: Tone;
    to: string;
  }> = [];

  // THE CUSTOMER BOOK, not merely selling. Khata is its own module — a
  // cash-only counter declines it — and /tenant/customers is gated on it, so
  // asking "does this shop sell" offered a tile that bounced.
  if (caps.keepsCustomers && caps.visit("/tenant/customers")) {
    tiles.push({
      key: "receivable",
      label: "Owed to you",
      value: money(receivable.total),
      caption:
        receivable.accounts === 0
          ? "nothing out on khata"
          : `${receivable.accounts} ${receivable.accounts === 1 ? "account" : "accounts"} on khata`,
      tone: receivable.total > 0 ? "warning" : "gray",
      to: "/tenant/customers",
    });
  }

  if (caps.buysFromSuppliers && caps.visit("/tenant/suppliers")) {
    tiles.push({
      key: "payable",
      label: "You owe",
      value: money(payable.total),
      caption:
        payable.accounts === 0
          ? "all suppliers settled"
          : `${payable.accounts} ${payable.accounts === 1 ? "supplier" : "suppliers"} waiting`,
      tone: payable.total > 0 ? "error" : "gray",
      to: "/tenant/suppliers",
    });
  }

  if (till) {
    tiles.push({
      key: "banked",
      label: "Banked today",
      value: money(till.banked_today),
      caption: till.banked_today > 0 ? "gone to the bank" : "nothing banked yet",
      tone: till.banked_today > 0 ? "success" : "gray",
      to: "/tenant/day",
    });
    tiles.push({
      key: "day",
      label: "Trading day",
      value: till.day_open ? "Open" : "Not started",
      caption: till.day_open
        ? till.open_shifts === 0
          ? "every shift counted out"
          : `${till.open_shifts} ${till.open_shifts === 1 ? "shift" : "shifts"} still on the till`
        : "opens when a cashier opens a drawer",
      tone: till.day_open && till.open_shifts > 0 ? "brand" : "gray",
      to: "/tenant/day",
    });
  }

  if (tiles.length === 0) return null;

  return (
    <SectionCard
      title="Money & the till"
      subtitle={data.branch_scope ? "This branch" : undefined}
      icon={<DollarLineIcon className="size-5" />}
      to={till ? "/tenant/day" : undefined}
      toLabel="Open Day"
    >
      <div className={tileGrid(tiles.length)}>
        {tiles.map(({ key, ...tile }) => (
          <StatTile key={key} {...tile} />
        ))}
      </div>
    </SectionCard>
  );
}
