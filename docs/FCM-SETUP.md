# FCM push — activation steps

Push is fully wired in code (`src/services/push.ts`) but stays **dormant
until Firebase is configured**. The app builds and runs fine without it.

## 1. Firebase project
1. Create a project at https://console.firebase.google.com
2. Add an **Android app** (package name from `android/app/build.gradle` →
   `applicationId`) → download `google-services.json` → place it at
   `android/app/google-services.json`
3. (Later) Add an **iOS app** → `GoogleService-Info.plist` → `ios/ShoposMobile/`

## 2. Install the packages
```bash
npm install @react-native-firebase/app @react-native-firebase/messaging
cd ios && pod install   # iOS only
```

## 3. Android gradle
`android/build.gradle` (buildscript.dependencies):
```gradle
classpath 'com.google.gms:google-services:4.4.2'
```
`android/app/build.gradle` (bottom of file):
```gradle
apply plugin: 'com.google.gms.google-services'
```

## 4. Backend credentials — a SERVICE ACCOUNT, not a server key

> **The old server key is dead.** Google switched the legacy FCM endpoint off
> in **July 2024**. `FCM_SERVER_KEY` authenticates nothing and is gone from the
> config; the backend now speaks **HTTP v1**, which wants an OAuth2 token
> minted from a service account.

1. Firebase console → **Project settings → Service accounts → Generate new
   private key**. You get a JSON file once, and cannot download it again.
2. Put it somewhere nothing serves. On the Laravel server:
   ```
   storage/app/private/fcm-service-account.json
   ```
   That directory is git-ignored (`storage/app/private/.gitignore` is `*`), so
   it cannot be committed by accident.
3. Point at it, relative to that private disk:
   ```
   FCM_CREDENTIALS=fcm-service-account.json
   FCM_CHANNEL=default
   ```
   An absolute path works too, and so does pasting the JSON itself for a
   container platform with nowhere to mount a file.
4. `php artisan config:clear`

Until set, the backend logs pushes instead of sending (dev mode). There is no
legacy endpoint left to fall back to.

**Never commit that file.** It can send notifications as you until it is
revoked — and revoking means generating a new key and updating the server.

## What happens once active
- On login: permission prompt → FCM token → `POST /devices` (auto re-registers on token rotation)
- On logout: `DELETE /devices` (this phone stops getting pushes)
- Notification tap (background or quit): reads `data.link`
  (`orders/{id}`, `announcements/{id}`, `rider`, `rider/application`, …) →
  deep-links to the exact screen via `src/navigation/deepLinks.ts`
- One request per device. v1 has no `registration_ids` array, so a phone with
  three devices is three sends; a token Google reports as `UNREGISTERED` is
  deleted, and a 500 or a rate limit is not (a blip must not cost somebody
  their notifications)

## Who this matters most to

The rider. A customer can open the app and look; a rider needs to be TOLD a job
exists. Until Firebase is installed here, the rider's board is the only signal —
it refreshes itself every fifteen seconds while the screen is open, and says
nothing while the phone is in a pocket.

Nothing else changes — the backend already attaches `data.link` to every
notification it sends.
