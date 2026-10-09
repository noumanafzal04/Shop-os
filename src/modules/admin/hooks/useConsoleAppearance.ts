import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiGet, apiPut } from "../../../common/api/client";
import { PLATFORM_LOOK, recallTenantTheme, rememberTenantTheme } from "../../../common/theme/rememberedTheme";
import { applyTenantTheme, DEFAULT_SIDEBAR, type SidebarStyle, type TintLevel } from "../../../common/theme/tenantTheme";
import type { AppearanceSource, ThemeLook } from "../../../components/theme/ThemeCustomizer";

/** The console's look as the server keeps it — `Admin\AppearanceController`. */
interface ConsoleLook {
  console_theme_primary: string | null;
  console_theme_tint: TintLevel;
  console_theme_sidebar: SidebarStyle;
}

const KEY = ["admin", "appearance"] as const;

export function useConsoleAppearance() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<ThemeLook> => {
      const look = (await apiGet<ConsoleLook>("/admin/appearance")).data;

      return {
        primary: look.console_theme_primary,
        tint: look.console_theme_tint ?? "subtle",
        sidebar: look.console_theme_sidebar ?? DEFAULT_SIDEBAR,
      };
    },
    // It changes when a super admin changes it, which is a few times a year.
    staleTime: 5 * 60_000,
  });
}

/**
 * Save the console's look — in the shape the canvas asks for.
 *
 * The canvas is told the outcome and SAYS it: "Saved", or the server's own
 * words under the Save button. So what is handed back here is its `save`,
 * with both halves of the outcome spelled out at the one place the request is
 * made — a failure passed along inside an object nobody can see into is how a
 * save comes to fail in silence.
 */
export function useSaveConsoleAppearance(): Pick<AppearanceSource, "save" | "saving"> {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (look: ThemeLook) =>
      apiPut<ConsoleLook>("/admin/appearance", {
        console_theme_primary: look.primary,
        console_theme_tint: look.tint,
        console_theme_sidebar: look.sidebar,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });

  return {
    saving: mutation.isPending,
    save: (look, on) => mutation.mutate(look, { onSuccess: on.onSuccess, onError: on.onError }),
  };
}

/**
 * PAINT THE CONSOLE in the platform's own look.
 *
 * The console had no look of its own to paint: it was drawn from the
 * sidebar's fallback and the stylesheet's colours, and never called
 * `applyTenantTheme` at all. It has one now (PlatformSettings), so it is
 * painted the way a shop is — and the three things a shop's painting had to
 * learn the hard way come with it:
 *
 *   UNTIL THE ANSWER ARRIVES the page keeps what this device remembers, so a
 *   console somebody turned emerald does not open blue for the length of a
 *   request on every reload (see rememberedTheme.ts);
 *
 *   IT IS REMEMBERED under the platform's own name, never under a shop's —
 *   one device is very often used for both;
 *
 *   AND IT IS TAKEN OFF on the way out. The sign-in page and the front page
 *   are not the console's to dress.
 */
export function useConsoleTheme(): void {
  const look = useConsoleAppearance();
  const loaded = look.data !== undefined;
  const primary = look.data?.primary ?? null;
  const tint = look.data?.tint ?? "subtle";
  const sidebar = look.data?.sidebar ?? DEFAULT_SIDEBAR;

  useEffect(() => {
    if (!loaded) {
      const kept = recallTenantTheme(PLATFORM_LOOK);
      if (kept) applyTenantTheme(kept);

      return;
    }

    const theme = { primary, tint, sidebar };
    applyTenantTheme(theme);
    rememberTenantTheme(PLATFORM_LOOK, theme);
  }, [loaded, primary, tint, sidebar]);

  useEffect(() => () => applyTenantTheme({}), []);
}
