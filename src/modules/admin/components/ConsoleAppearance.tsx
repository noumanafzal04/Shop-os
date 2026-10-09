import { DEFAULT_SIDEBAR } from "../../../common/theme/tenantTheme";
import { AppearanceCanvas } from "../../../components/theme/ThemeCustomizer";
import { useAuthStore } from "../../../stores/authStore";
import { useConsoleAppearance, useSaveConsoleAppearance } from "../hooks/useConsoleAppearance";

/**
 * THE CONSOLE'S OWN Appearance.
 *
 * A shop has always been able to choose its colour and what its menu is
 * painted in. Whoever ran the platform could dress every shop on it and not
 * their own screen: the console was drawn from a fallback and had no canvas.
 *
 * Asked for in these words: "keep the admin side primary — the sidebar and
 * the colour theme — and let them change it themselves too". So the default
 * is what it was (the house colour, the menu in it), and this is the same
 * canvas a shop has, kept in the platform's settings instead of a shop's.
 *
 * ── Whose look, and who holds the brush ────────────────────────────────
 *
 * The PLATFORM's: one look, saved once, worn by everybody on the console —
 * as a shop's is by everybody who works there. So only a super admin may
 * change it, and for anybody else the launcher is not drawn at all: a control
 * whose Save can only be refused is worse than no control. Light or dark is
 * the personal one, and rides the header toggle on every console screen.
 */
export function ConsoleAppearance() {
  const look = useConsoleAppearance();
  const { save, saving } = useSaveConsoleAppearance();
  const isSuperAdmin = useAuthStore((s) => s.user?.role === "super_admin");

  return (
    <AppearanceCanvas
      source={{
        stored: {
          primary: look.data?.primary ?? null,
          tint: look.data?.tint ?? "subtle",
          sidebar: look.data?.sidebar ?? DEFAULT_SIDEBAR,
        },
        canConfigure: isSuperAdmin,
        saving,
        // The canvas says how it went — "Saved", or the server's words under
        // the button.
        save,
        savedFor: "everyone on the console",
      }}
    />
  );
}
