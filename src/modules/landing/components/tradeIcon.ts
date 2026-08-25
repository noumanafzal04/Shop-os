import {
  AutomotiveIcon, FinanceIcon, FoodIcon, MartIcon,
  PetroleumIcon, PharmacyIcon, RetailIcon, ServicesIcon,
} from "./TradeIcons";

/**
 * Trade code → its icon. In its own file because a module that exports both
 * components and a plain object loses fast refresh for the components — the
 * lint rule says so, and a landing page is exactly the sort of thing somebody
 * tweaks twenty times in a row.
 */
export const TRADE_ICON = {
  food: FoodIcon,
  mart: MartIcon,
  pharmacy: PharmacyIcon,
  retail: RetailIcon,
  services: ServicesIcon,
  automotive: AutomotiveIcon,
  finance: FinanceIcon,
  petroleum: PetroleumIcon,
} as const;

export type TradeCode = keyof typeof TRADE_ICON;
