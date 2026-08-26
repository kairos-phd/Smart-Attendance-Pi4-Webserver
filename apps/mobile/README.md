# Mobile companion (Android and iOS)

This Expo/React Native application uses the same Firebase Authentication, Firestore and Storage as the dashboard. It is a read-oriented companion for the team’s two-camera MVP: attendance, unknown events, device state and account information are visible on a phone, while privileged face enrollment stays in the dashboard/API.

## Setup

1. Install Node.js 22.13+ (required by the current Expo SDK) and Expo Go on the test Android/iOS device.
2. Copy `.env.example` to `.env` and supply the Firebase **web app** configuration values.
3. Run:

   ```bash
   npm install
   npx expo start
   ```

4. Scan the QR code using Expo Go, or use `npm run android` / `npm run ios` with an emulator.
5. Before release builds, replace the placeholder iOS bundle ID and Android package in `app.json` with identifiers owned by the team. Run `npm run doctor` after dependency changes.

The current Expo SDK/React Native pairing is intentionally pinned as a tested compatibility set; do not independently upgrade React Native. Refer to the [Expo SDK reference](https://docs.expo.dev/versions/latest/) when intentionally upgrading.
