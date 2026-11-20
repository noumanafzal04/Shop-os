/**
 * EDIT PROFILE — what the form checks before it lets you save.
 *
 * The server checks the same things, but its answer came back as one line at
 * the top of the page after a round trip. Each field now says what is wrong
 * beside itself, as you type, and Save stays off until the form can pass.
 */

export interface ProfileDraft {
  name: string;
  email: string;
  phone: string;
}

export type ProfileErrors = Partial<Record<keyof ProfileDraft, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Digits with the usual spacers; a leading + for an international number. */
const PHONE = /^\+?[\d\s-]+$/;

export function digitsOf(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function profileErrors(d: ProfileDraft): ProfileErrors {
  const out: ProfileErrors = {};
  const name = d.name.trim();
  const email = d.email.trim();
  const phone = d.phone.trim();

  if (name.length < 2) out.name = "Enter your name — at least 2 letters.";
  else if (name.length > 255) out.name = "Keep your name under 255 characters.";

  if (email && !EMAIL.test(email)) out.email = "That doesn't look like an email address.";

  if (phone) {
    const n = digitsOf(phone).length;
    if (!PHONE.test(phone) || n < 10 || n > 15) out.phone = "Enter a phone number a rider can call, e.g. 0300 1234567.";
  }

  // One way to reach you must remain — the account signs in with it.
  if (!email && !phone) out.phone = out.phone ?? "Keep an email or a phone number on your account.";

  return out;
}

export function isChanged(
  d: ProfileDraft,
  was: { name?: string | null; email?: string | null; phone?: string | null },
) {
  return (
    d.name.trim() !== (was.name ?? "") || d.email.trim() !== (was.email ?? "") || d.phone.trim() !== (was.phone ?? "")
  );
}

/** Initials for the avatar: first letters of the first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}
