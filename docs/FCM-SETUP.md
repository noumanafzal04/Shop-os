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

## 4. Backend credentials
Set on the Laravel server (see `config/services.php`):
```
FCM_SERVER_KEY=...   # from Firebase console → Cloud Messaging
```
Until set, the backend logs pushes instead of sending (dev mode).

## What happens once active
- On login: permission prompt → FCM token → `POST /devices` (auto re-registers on token rotation)
- On logout: `DELETE /devices` (this phone stops getting pushes)
- Notification tap (background or quit): reads `data.link`
  (`orders/{id}`, `announcements/{id}`, …) → deep-links to the exact screen
  via `src/navigation/deepLinks.ts`

Nothing else changes — the backend already attaches `data.link` to every
notification it sends.
