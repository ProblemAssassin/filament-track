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

## Verification

The security tests run against the local Firestore emulator, never a production database. They check account isolation, verified-owner access, atomic one-roll updates, idempotent and concurrent retries, barcode/SKU uniqueness, negative-stock rejection, paired event receipts, and the restricted opening-stock import.

The UI and bridge tests check sign-in-first navigation, restored sessions, sign-out, account-bound pending saves, account-change race handling, CSV import and measured save confirmation. Shared scanner and inventory tests remain in `../tests/`.

Live sign-in, database commissioning, migration and mobile save latency must be verified before treating this trial as production. Local test success alone does not establish live deployment or performance.
