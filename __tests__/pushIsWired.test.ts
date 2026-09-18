import { fs, path, PROJECT_ROOT, codeOnly } from "./support/node";

const read = (p: string) => fs.readFileSync(path.join(PROJECT_ROOT, p), "utf8");
const manifest = () => read("android/app/src/main/AndroidManifest.xml");
const push = () => codeOnly(read("src/services/push.ts"));

/**
 * PUSH FAILS SILENTLY, IN FOUR DIFFERENT PLACES.
 *
 * Every one of these breaks a notification with no error on the phone, nothing
 * in logcat naming the cause, and an app that believes it is working. A shop
 * waits for a bell that can never ring.
 */
describe("push notifications are actually wired", () => {
  it("applies the Google Services gradle plugin", () => {
    /**
     * Without it, `google-services.json` is a file nobody reads: the build
     * succeeds, the app installs, and Firebase has no project to talk to.
     * Both halves are needed — the classpath in the root build and the plugin
     * in the app build — and having one without the other fails at BUILD time,
     * which is the good case.
     */
    expect(read("android/build.gradle")).toContain("com.google.gms:google-services");
    expect(read("android/app/build.gradle")).toContain(
      'apply plugin: "com.google.gms.google-services"',
    );
  });

  it("declares a notification channel that matches what the server sends", () => {
    /**
     * Android 8 and later DROP a notification whose channel it does not
     * recognise — silently. The server sends `default`
     * (config/services.php → FCM_CHANNEL), so the manifest must say `default`
     * and nothing else.
     */
    const m = manifest();
    expect(m).toContain("com.google.firebase.messaging.default_notification_channel_id");
    expect(m).toMatch(/default_notification_channel_id"[\s\S]{0,120}android:value="default"/);
  });

  it("declares POST_NOTIFICATIONS and asks for it at runtime", () => {
    /**
     * Android 13+ shows nothing until the person has been asked, and the
     * SDK's `requestPermission()` does NOT raise the OS dialog on Android —
     * it is an iOS call that returns "authorised" regardless. Declaring the
     * permission without requesting it is the silent-failure version of this
     * whole file.
     */
    expect(manifest()).toContain("android.permission.POST_NOTIFICATIONS");

    const code = push();
    expect(code).toContain("PermissionsAndroid.request");
    expect(code).toContain("POST_NOTIFICATIONS");
  });

  it("handles a tap from every state the app can be in", () => {
    /**
     * Three, and the third is the one that gets forgotten:
     *
     *   foreground  `onMessage` — Android draws nothing itself here
     *   background  `onNotificationOpenedApp`
     *   NOT RUNNING `getInitialNotification` — a phone asleep with the app
     *               killed, which is most of a night shift. Without it the
     *               commonest tap of all opens the dashboard and the order is
     *               never found.
     */
    /**
     * CALLED, not imported — and the difference is not pedantry.
     *
     * The first version of this case asserted `toContain("getInitialNotification")`.
     * Deleting the CALL while leaving the import kept it green: the guard was
     * checking that a name appeared in the file, which an unused import
     * satisfies perfectly. Mutating it is the only way that shows.
     */
    const code = push();
    // Skip the import block — a name can sit there while nothing uses it.
    const body = code.slice(code.indexOf("export type PushTap"));
    expect(body).toMatch(/onMessage\s*\(/);
    expect(body).toMatch(/onNotificationOpenedApp\s*\(/);
    expect(body).toMatch(/getInitialNotification\s*\(/);
  });

  it("registers the device only after there is a session, and unregisters on sign-out", () => {
    /**
     * A token registered against nobody is a push nobody receives. And on the
     * way out the order matters: `stopPush` needs the token it is about to
     * throw away, so it runs BEFORE `clear()` — done the other way round the
     * call goes out unauthenticated, and the server keeps pushing this shop's
     * orders, naming a customer each time, to a phone somebody else is now
     * holding.
     */
    const nav = codeOnly(read("src/navigation/RootNavigator.tsx"));
    expect(nav).toMatch(/status !== "authenticated"[\s\S]{0,80}return/);
    expect(nav).toContain("startPush");

    const account = codeOnly(read("src/modules/account/screens/AccountScreen.tsx"));
    const stopAt = account.indexOf("stopPush()");
    const clearAt = account.indexOf("clear()");
    expect(stopAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(-1);
    expect(stopAt).toBeLessThan(clearAt);
  });

  it("keeps the poll as well as the push", () => {
    /**
     * A push that is missed — permission refused, battery saver, a phone that
     * slept — must not be the difference between a late order and a lost one.
     * Push makes it fast; the poll makes it certain, and deleting the poll
     * because "we have notifications now" is the change this guards against.
     */
    const hooks = codeOnly(read("src/modules/orders/hooks/useOrders.ts"));
    expect(hooks).toMatch(/refetchInterval/);
  });
});
