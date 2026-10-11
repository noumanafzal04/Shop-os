import type React from "react";

/**
 * ONE ROW OF THE RAIL — the shape both menus are written in.
 *
 * It lived inside the sidebar component, which was fine while the sidebar was
 * the only thing that knew what a menu was. The shop's menu is its own file
 * now, and so is the arithmetic of a person's Simple view; a type three files
 * need does not belong to the one that happens to draw it.
 */
export type SubItem = {
  name: string;
  path: string;
  pro?: boolean;
  new?: boolean;
  /**
   * The screen its group is NAMED for — the product list under Products, the
   * stock list under Inventory.
   *
   * A group left holding one screen is drawn as a plain link, and this is how
   * that link is named: the group's own word when the screen left is its home
   * ("Products"), the screen's when it is not ("Barcode labels"). Without it a
   * shortened menu either lies about where a link goes or says "All products"
   * where a shopkeeper expects "Products".
   */
  home?: boolean;
  /** In the Simple view until the person says otherwise. See `simpleMenu.ts`. */
  usual?: boolean;
};

export type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: SubItem[];
  /**
   * HOW MANY PEOPLE ARE WAITING BEHIND THIS ITEM.
   *
   * Only ever a count of things a person is waiting on — never a total, never
   * a "new since you last looked". Two queues on this platform hold a human
   * being rather than a record, both sort oldest-first because a slow reply
   * costs the customer nothing, and neither of them nags. So the number moves
   * to where the admin already is.
   *
   * Zero and undefined both draw nothing. A badge showing "0" is a permanent
   * mark on the rail that doing the job cannot clear.
   */
  badge?: number;
  /**
   * Which part of the rail this row belongs to. Rows that share one are drawn
   * together under its heading; a change of section is a heading (or, on a
   * rail of icons, a hairline).
   *
   * The shop's menu was one unbroken column — sixteen rows in Full view with
   * nothing to say where "what I do all day" stops and "what I set up once"
   * begins. Three parts, in the order a day uses them.
   */
  section?: string;
  /** In the Simple view until the person says otherwise. See `simpleMenu.ts`. */
  usual?: boolean;
};
