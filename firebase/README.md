# Firebase trial

This is a separate trial of the FilamentTrack frontend with Firebase Authentication and Cloud Firestore. The existing Google Sheets app at the repository root remains available while the trial is commissioned.

Entry flow: Sign in with Google → inventory dashboard. Saved sessions load the dashboard directly. The account menu includes Switch Google account and Sign out. Each confirmed Add or Use changes stock by exactly one roll.

## Private setup

The public web SDK configuration is an application identifier, not a database credential. Do not add service-account keys, owner email addresses, user IDs, or private spreadsheet links to this repository.

1. Enable Google as a Firebase Authentication provider and authorise `problemassassin.github.io` as a sign-in domain.
2. Create the default Cloud Firestore database in a nearby region, initially in production mode. Publish `firestore.rules` before allowing app use.
3. Sign in through the trial. In the Firebase console, create the private document `owners/<Google user UID>` with boolean fields `enabled: true` and `importOpen: true`. The UID is available in Authentication → Users. Only this allowlisted, verified account can access its own inventory.
4. Export the current inventory CSV from the existing app. Import it once through the trial's account menu. Verify counts against the original Sheet. Then set the owner's `importOpen` to `false` in the Firebase console.
5. Keep only one app as the active writer after cutover. A Sheets reporting integration must be separately configured; Firebase saves do not automatically update the old Sheet.

Initial deployment remains on the Spark plan. No Cloud Functions or paid services are required for these browser transactions.

## Commissioning status — 1 November 2026

The separate Firebase project is created on Spark. Google sign-in is enabled, and `problemassassin.github.io` is an authorised domain. The default Standard Firestore database is created in `asia-southeast1` (Singapore). The tested `firestore.rules` were published at approximately 4:37 pm Singapore time. The trial entry page and official SDK files load over HTTPS.

Owner sign-in, private allowlist setup and opening-stock import are complete. The imported balance was one variety / one roll. A live Add changed 1 → 2 and Use restored 2 → 1; each displayed a measured 0.2-second save confirmation on the desktop browser. A fresh load returned directly to the dashboard and confirmed one roll. Opening-stock import was then closed in the private owner record. These desktop measurements do not establish phone latency. This is a personal inventory app; publishing the interface does not make inventory public. Main-link cutover and automatic Sheet reporting remain pending.

`../apps-script/FirebaseReports.gs` is an optional, locally tested reporting integration. It reads Firestore into separate **Firebase Inventory** and **Firebase Sync** tabs in the owner's existing private spreadsheet, about every five minutes. It does not participate in app saves or modify the original inventory/journal tabs. It is not enabled by merely publishing this source. Deployment requires the owner's private UID Script Property, the additional datastore OAuth scope and owner authorisation. Authentication tokens are obtained at runtime and are never stored in source.

## Verification

The security tests run against the local Firestore emulator, never a production database. They check account isolation, verified-owner access, atomic one-roll updates, idempotent and concurrent retries, barcode/SKU uniqueness, negative-stock rejection, paired event receipts, and the restricted opening-stock import.

The UI and bridge tests check sign-in-first navigation, restored sessions, sign-out, account-bound pending saves, account-change race handling, CSV import and measured save confirmation. Shared scanner and inventory tests remain in `../tests/`.

The shared scanner's barcode-first update removes still-image retry loops, requests 1280×720 camera video, bounds camera startup and preview waits, stops the web camera before native photo capture, and starts OCR only for an explicit label read/photo. Unknown codes offer Take label photo. The English model changed from a 10.9 MB file to the SDK's compressed 3.0 MB LSTM model. Physical phone-camera behaviour still requires device verification; local test timings are not phone benchmarks.
