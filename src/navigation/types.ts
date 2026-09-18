import type { PartnerTab } from "./tabsFor";

/**
 * The tab names ARE the route names. One list, so a tab that exists in the bar
 * and not in the navigator is a type error rather than a dead press.
 */
export type PartnerTabParamList = Record<PartnerTab, undefined>;

export type RootStackParamList = {
  SignIn: undefined;
  Tabs: undefined;
};
