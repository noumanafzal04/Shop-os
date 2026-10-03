import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeScreen } from "@cartze/core/ui/SafeScreen";
import { KeyboardScreen } from "@cartze/core/ui/KeyboardScreen";
import { AppTextInput } from "@cartze/core/ui/AppTextInput";
import { AppButton } from "@cartze/core/ui/AppButton";
import { EnvelopeIcon, LockIcon } from "@cartze/core/ui/icons";
import { ApiError } from "@cartze/core/types/api";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { BRAND } from "../../../common/brand";
import { useAuthStore } from "../../../stores/authStore";
import { authService } from "../services/authService";

/**
 * ONE FORM, AND THE SAME CREDENTIALS AS THE PANEL.
 *
 * There is no separate "partner account". The owner, or any staff member the
 * owner created, signs in here with what they already use on the web. What a
 * person can DO once inside is their permission list — see `tabsFor`.
 *
 * ── Why one field takes an email OR a phone ──────────────────────────
 *
 * The server's `identifier` accepts either. A shop in Lahore is far more
 * likely to know its phone number than the address it was registered with, and
 * making somebody choose a field before they have typed anything is a decision
 * they should not have to make. The keyboard stays default rather than
 * `email-address` for the same reason — a numeric-leaning keyboard would
 * quietly take a side.
 */
export function SignInScreen() {
  const c = useColors();
  const s = styles(c);
  const setAuth = useAuthStore((st) => st.setAuth);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = identifier.trim().length > 0 && password.length > 0;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await authService.login(identifier, password);
      const { user, access_token, refresh_token } = res.data;
      await setAuth(user, access_token, refresh_token);
    } catch (e) {
      /**
       * WHAT WENT WRONG, IN THE WORDS OF WHOEVER KNOWS.
       *
       * A field error ("The identifier field is required") is more specific
       * than the envelope's message, so it wins when there is one. A network
       * failure is not an ApiError at all and must not be reported as "wrong
       * password" — the commonest way a sign-in screen lies.
       */
      if (e instanceof ApiError) {
        setError(e.firstFieldError() ?? e.message);
      } else {
        setError("Could not reach CartZe. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeScreen>
      <KeyboardScreen contentStyle={s.content}>
        <View style={s.head}>
          <Text style={s.wordmark}>{BRAND.family}</Text>
          <Text style={s.sub}>Partner</Text>
        </View>

        <Text style={s.title}>Sign in to your shop</Text>
        <Text style={s.lede}>
          Use the same email or phone and password you use on the CartZe web panel.
        </Text>

        <View style={s.form}>
          <AppTextInput
            label="Email or phone"
            icon={EnvelopeIcon}
            // An empty field showing nothing but an icon reads as a box that
            // failed to load. It also has to carry BOTH shapes, because the
            // label cannot show two examples and the server takes either.
            placeholder="you@shop.pk  or  03xx xxxxxxx"
            value={identifier}
            onChangeText={(t) => {
              setIdentifier(t);
              if (error) setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            // No `keyboardType`: the field takes either, and a numeric or
            // email-leaning keyboard would decide for them.
            textContentType="username"
            returnKeyType="next"
            editable={!busy}
          />

          <AppTextInput
            label="Password"
            icon={LockIcon}
            placeholder="Your panel password"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (error) setError(null);
            }}
            secureTextEntry
            autoCapitalize="none"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!busy}
          />

          {error ? (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <AppButton
            title="Sign in"
            onPress={submit}
            loading={busy}
            disabled={!ready}
            size="lg"
            style={s.submit}
          />
        </View>

        <Text style={s.foot}>
          Forgotten your password? Reset it on {BRAND.domain}, then sign in here.
        </Text>
      </KeyboardScreen>
    </SafeScreen>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    /**
     * `flexGrow` + centred, and the footnote pushed to the bottom.
     *
     * The first version was `paddingTop: xxl` and nothing else, which stacked
     * everything against the top and left the bottom 40% of the phone empty —
     * the form floating in a void rather than sitting on the page. Growing to
     * the full height and centring spreads that space above and below, and
     * `marginTop: "auto"` on the foot anchors the one line that belongs at the
     * bottom. On a small screen with the keyboard up it still scrolls, because
     * this is flexGrow and not a fixed height.
     */
    content: {
      flexGrow: 1,
      padding: spacing.lg,
      paddingTop: spacing.xl,
      paddingBottom: spacing.lg,
      justifyContent: "center",
    },
    head: { alignItems: "center", marginBottom: spacing.xl },
    // logotype — WCAG 1.4.3 exempts a brand mark from the contrast floor, and
    // this one is 34pt bold. Every other use of `c.primary` as a colour for
    // text or an icon is banned; see `houseRules`.
    wordmark: { ...typography.display, fontSize: 34, color: c.primary, letterSpacing: -0.6 },
    sub: {
      ...typography.label,
      fontSize: 15,
      color: c.textSecondary,
      letterSpacing: 3,
      textTransform: "uppercase",
      marginTop: spacing.xs,
    },
    title: { ...typography.title, color: c.text },
    lede: {
      ...typography.body,
      color: c.textSecondary,
      marginTop: spacing.sm,
      lineHeight: 22,
    },
    form: { gap: spacing.md, marginTop: spacing.xl },
    errorBox: {
      backgroundColor: c.errorBg,
      borderRadius: 12,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
    },
    errorText: { ...typography.label, fontWeight: "500", color: c.error, lineHeight: 20 },
    submit: { marginTop: spacing.xs },
    /**
     * `textSecondary`, not `textMuted`.
     *
     * This sentence tells somebody locked out what to actually do, so it is
     * text a person must read — and `textMuted` measured 2.35:1 on the page
     * when this screen was first run on a phone: visibly grey-on-grey in the
     * screenshot. The token has been raised to 3.4:1 as well, but a line this
     * load-bearing should not be sitting in the faintest tier at all.
     */
    foot: {
      ...typography.small,
      color: c.textSecondary,
      textAlign: "center",
      marginTop: "auto",
      paddingTop: spacing.xl,
      lineHeight: 19,
    },
  });
