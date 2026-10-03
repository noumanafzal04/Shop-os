import { fs, path, PROJECT_ROOT, codeOnly } from "./support/node";

const read = (p: string) => fs.readFileSync(path.join(PROJECT_ROOT, p), "utf8");
const manifest = () => read("android/app/src/main/AndroidManifest.xml");
const push = () => codeOnly(read("src/services/push.ts"));

/**
 * THE CUSTOMER APP'S PUSH HAD NEVER WORKED, AND NOTHING SAID SO.
 *
 * Every defect below fails in silence: no error on the phone, nothing in
 * logcat naming the cause, and an app that believes it is fine. When this file
 * was written the customer app had FOUR of them at once, and they hid each
 * other:
 *
 *   1. `@react-native-firebase/*` was not a dependency at all
 *   2. the Google Services gradle plugin was not applied
 *   3. `POST_NOTIFICATIONS` was not declared in the manifest
 *   4. no notification channel was declared
 *
 * And `push.ts` loaded Firebase through a `require` inside a try/catch, with a
 * comment promising that "once the package + config files are in place, this
 * activates with no code changes". The catch swallowed the missing package on
 * every single run. The app shipped believing push was merely switched off.
 *
 * The partner app had every one of these right. One app fixed and the other
 * left is the shape this codebase keeps meeting — a rule applied to one half.
 */
describe("push notifications are actually wired", () => {
  it("depends on Firebase for real, not through a try/catch", () => {
    /**
     * A dynamic `require` in a try/catch turns "this package is missing" into
     * "push is off today", which is indistinguishable from working correctly
     * on a phone with notifications disabled. A static import makes a missing
     * package a BUILD failure — which is the outcome you want.
     */
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(
      expect.arrayContaining(["@react-native-firebase/app", "@react-native-firebase/messaging"]),
    );

    const raw = read("src/services/push.ts");
    expect(raw).toContain('from "@react-native-firebase/messaging"');
    expect(raw).not.toMatch(/require\(\s*["']@react-native-firebase/);
  });

  it("applies the Google Services gradle plugin", () => {
    /**
     * Without it, `google-services.json` is a file nobody reads: the build
     * succeeds, the app installs, and Firebase has no project to talk to.
     * Both halves are needed — the classpath in the root build and the plugin
     * in the app build.
     */
    expect(read("android/build.gradle")).toContain("com.google.gms:google-services");
    expect(read("android/app/build.gradle")).toContain(
      'apply plugin: "com.google.gms.google-services"',
    );
  });

  it("ships a google-services.json whose package matches this app", () => {
    /**
     * A config file from the WRONG app is the cruellest version of this bug:
     * the build succeeds, Firebase initialises, a token is issued against
     * another application id, and every send is accepted and delivered
     * nowhere. Both apps live in one Firebase project, which makes the mix-up
     * easy.
     */
    const cfg = JSON.parse(read("android/app/google-services.json")) as {
      client: Array<{ client_info: { android_client_info: { package_name: string } } }>;
    };
    const packages = cfg.client.map((c) => c.client_info.android_client_info.package_name);

    const applicationId = (read("android/app/build.gradle").match(
      /applicationId\s+"([\w.]+)"/,
    ) ?? [])[1];

    expect(typeof applicationId).toBe("string");
    expect(packages).toContain(applicationId);
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
    expect(m).toMatch(/default_notification_channel_id"[\s\S]{0,140}android:value="default"/);
  });

  it("declares POST_NOTIFICATIONS and asks for it at runtime", () => {
    /**
     * Android 13+ shows nothing until the person has been asked, and the SDK's
     * `requestPermission()` does NOT raise the OS dialog on Android — it is an
     * iOS call that returns AUTHORIZED regardless. This app trusted its answer
     * AND had never declared the permission, so the two defects hid each
     * other: the app was certain push was on, the phone dropped everything.
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
     *               killed. Without it the commonest tap of all opens the home
     *               screen and the order is never found.
     *
     * CALLED, not imported. The partner app's version of this case first
     * asserted the NAME appeared in the file, which an unused import satisfies
     * perfectly; only mutation showed it. The import block is skipped here for
     * that reason.
     */
    const code = push();
    const body = code.slice(code.indexOf("type Unsubscribe"));
    expect(body).toMatch(/onMessage\s*\(/);
    expect(body).toMatch(/onNotificationOpenedApp\s*\(/);
    expect(body).toMatch(/getInitialNotification\s*\(/);
  });

  it("registers the device only once there is a session, and unregisters on sign-out", () => {
    /**
     * A token registered against nobody is a push nobody receives. And on the
     * way out a shared phone must stop ringing for the last person's orders —
     * the notification names a customer, which makes it a leak rather than an
     * annoyance.
     */
    const nav = codeOnly(read("src/navigation/RootNavigator.tsx"));
    expect(nav).toMatch(/status === "authenticated"[\s\S]{0,40}initPush\(\)/);

    const auth = codeOnly(read("src/modules/auth/hooks/useAuth.ts"));
    expect(auth).toContain("teardownPush()");
  });
});
