import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";
import { digitsOf, initials, isChanged, profileErrors } from "../src/modules/account/profileForm";

/**
 * "EDIT PROFILE SCREEN B BETTER KRO." The old form said what was wrong in one
 * line at the top AFTER a round trip; each field now answers for itself and
 * Save stays off until the form can pass.
 */
const ok = { name: "Ayesha Khan", email: "ayesha@app.com", phone: "0300 1234567" };

describe("what the profile form checks", () => {
  it("passes a normal profile", () => {
    expect(profileErrors(ok)).toEqual({});
  });

  it("needs a name of at least two letters", () => {
    expect(profileErrors({ ...ok, name: " A " }).name).toBeDefined();
    expect(profileErrors({ ...ok, name: "Al" }).name).toBeUndefined();
    expect(profileErrors({ ...ok, name: "x".repeat(256) }).name).toBeDefined();
  });

  it("checks an email only when one is given", () => {
    expect(profileErrors({ ...ok, email: "ayesha@app" }).email).toBeDefined();
    expect(profileErrors({ ...ok, email: "a b@app.com" }).email).toBeDefined();
    expect(profileErrors({ ...ok, email: "" }).email).toBeUndefined();
  });

  it("takes a Pakistani or international number, with spaces or dashes", () => {
    for (const p of ["03001234567", "0300 1234567", "0300-1234567", "+92 300 1234567"]) {
      expect(profileErrors({ ...ok, phone: p }).phone).toBeUndefined();
    }
    for (const p of ["12345", "0300 12a4567", "+92 300 1234567 1234567"]) {
      expect(profileErrors({ ...ok, phone: p }).phone).toBeDefined();
    }
  });

  it("keeps at least one way to sign in", () => {
    expect(profileErrors({ ...ok, email: "", phone: "" }).phone).toBeDefined();
    expect(profileErrors({ ...ok, email: "", phone: "03001234567" })).toEqual({});
  });

  it("knows when nothing changed (spaces do not count)", () => {
    expect(isChanged({ ...ok, name: " Ayesha Khan " }, ok)).toBe(false);
    expect(isChanged({ ...ok, phone: "03001234568" }, ok)).toBe(true);
    expect(isChanged({ name: "A", email: "", phone: "" }, { name: null, email: null, phone: null })).toBe(true);
  });

  it("draws two initials, or one, or none", () => {
    expect(initials("ayesha khan")).toBe("AK");
    expect(initials("  Bilal  ")).toBe("B");
    expect(initials("Muhammad Ali Jinnah")).toBe("MA");
    expect(initials("   ")).toBe("");
    expect(digitsOf("+92 (300) 123-4567")).toBe("923001234567");
  });
});

describe("the screen uses it", () => {
  const screen = codeOnly(
    fs.readFileSync(path.join(PROJECT_ROOT, "src/modules/account/screens/ProfileScreen.tsx"), "utf8"),
  );

  it("keeps Save off while a field is wrong", () => {
    expect(screen).toMatch(/disabled=\{!changed \|\| !valid \|\| save\.isPending\}/);
    expect(screen).toMatch(/profileErrors\(\{ name, email, phone \}\)/);
  });

  it("shows each field's own error, and offers the password change", () => {
    expect(screen).toMatch(/error=\{shown\("name"\)\}/);
    expect(screen).toMatch(/error=\{shown\("email"\)\}/);
    expect(screen).toMatch(/error=\{shown\("phone"\)\}/);
    expect(screen).toMatch(/navigate\("Security"\)/);
  });
});
