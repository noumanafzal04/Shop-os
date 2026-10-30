/**
 * IS THIS FILE A PICTURE THE SERVER WILL TAKE? (#NE1)
 *
 * The server's rule for a product picture is `image`, `mimes:jpg,jpeg,png,webp`,
 * `max:4096` — and a file it refused came back in its own words: "The images.0
 * field must be an image.", or for a 9 MB photo, "The POST data is too large."
 * The picker already knows the rule, so it says it — in the shop's words, before
 * anything is sent. A file that only LOOKS like a picture (text renamed .jpg)
 * still reaches the server, which reads the content and refuses it in the same
 * words.
 */
export const PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PICTURE_MAX_BYTES = 4 * 1024 * 1024;

export const NOT_A_PICTURE = "That file is not a picture. Use a JPG, PNG or WebP under 4 MB.";
export const PICTURE_TOO_BIG = "That picture is over 4 MB. Use a JPG, PNG or WebP under 4 MB.";

/** Null when the file may be sent; otherwise the sentence to show. */
export function pictureRefusal(file: Pick<File, "type" | "size">): string | null {
  if (!(PICTURE_TYPES as readonly string[]).includes(file.type)) return NOT_A_PICTURE;
  if (file.size > PICTURE_MAX_BYTES) return PICTURE_TOO_BIG;

  return null;
}
