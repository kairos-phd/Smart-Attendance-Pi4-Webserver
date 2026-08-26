# Firebase setup

1. Create a Firebase project. Enable **Authentication > Email/Password**, **Cloud Firestore** (production mode) and **Cloud Storage**.
2. Register a Web App. Copy its public configuration values to `apps/web/.env` and `apps/mobile/.env` from their examples. Copy the exact Cloud Storage bucket name from the Firebase console to `FIREBASE_STORAGE_BUCKET` in both server-side `.env` files. It is commonly, but not always, derived from the project ID.
3. Create a service account under **Project settings > Service accounts**. Download the JSON only to the Pi/server, for example `/opt/smart-attendance/secrets/firebase-service-account.json`; do not commit it.
4. Deploy the supplied rules and indexes from a development computer with Firebase CLI:

   ```bash
   firebase login
   firebase use --add
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```

5. Create the first dashboard administrator in Firebase Authentication. Then use the Firebase Admin SDK from a trusted computer to add the custom claim `admin: true`:

   ```bash
   python scripts/make_admin.py AUTHENTICATION_UID --service-account /secure/path/service-account.json
   ```

   The user must sign out and in again to refresh the claim. The helper needs `firebase-admin` installed and must never be run from a browser/mobile device.

6. Restrict the Storage bucket and Firebase project to the team. Face images and embeddings are sensitive personal data; obtain the required consent before enrollment.

For a demonstration, the first admin can be provisioned with the helper script described in the Runbook. Do not weaken production rules simply to make the UI work.
