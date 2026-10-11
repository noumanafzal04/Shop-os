import { useCallback, useEffect, useState } from "react";

import { NO_CHOICE, asChoice, type SimpleChoice } from "./simpleMenu";

/**
 * WHERE A PERSON'S SIMPLE MENU IS KEPT — on this device, under their own name.
 *
 * Beside the switch it belongs to: Simple / Full view is remembered per
 * device, because the till by the door and the laptop in the back office are
 * used for different work by the same person. What is ON the Simple view
 * follows the same rule, with one difference — a till is shared and a menu is
 * not, so the key carries who it belongs to. Two cashiers on one tablet each
 * get their own.
 *
 * This file is the only place that knows it is localStorage. Moving the
 * choice to the account is a change to these few lines.
 */
const keyFor = (userId: string) => `shopos-simple-menu:${userId}`;

export function readChoice(userId: string | undefined): SimpleChoice {
  if (userId === undefined) return NO_CHOICE;

  try {
    return asChoice(JSON.parse(localStorage.getItem(keyFor(userId)) ?? "null"));
  } catch {
    // A private window, a full disk, a value somebody edited by hand: the
    // usual menu, which is what a person who never chose anything has.
    return NO_CHOICE;
  }
}

export function writeChoice(userId: string | undefined, choice: SimpleChoice): void {
  if (userId === undefined) return;

  try {
    if (choice.add.length === 0 && choice.drop.length === 0) {
      // Nothing chosen is nothing kept — not an empty record that reads, a
      // year on, as a decision somebody made.
      localStorage.removeItem(keyFor(userId));
    } else {
      localStorage.setItem(keyFor(userId), JSON.stringify(choice));
    }
  } catch {
    // The menu still changes for this visit; it just is not remembered.
  }
}

/** This person's choice, and the way to change it. */
export function useSimpleChoice(userId: string | undefined): [SimpleChoice, (next: SimpleChoice) => void] {
  const [choice, setChoice] = useState<SimpleChoice>(() => readChoice(userId));

  // Somebody else signs in on the same tablet: their menu, not the last one's.
  useEffect(() => {
    setChoice(readChoice(userId));
  }, [userId]);

  const change = useCallback((next: SimpleChoice) => {
    setChoice(next);
    writeChoice(userId, next);
  }, [userId]);

  return [choice, change];
}
