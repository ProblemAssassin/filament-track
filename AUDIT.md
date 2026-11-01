# FilamentTrack release audit

Date: 1 November 2026 (Singapore time).

## Shipped behaviour

- Add Filament / Use Filament sets the mode for the complete scanning session.
- Every accepted result changes storage by exactly one roll. No quantity selector is present.
- Detected details appear above the camera or held photo. Recognition never changes stock by itself.
- OK saves and finishes. Scan another box saves once, retains the mode, and clears the previous result.
- Manual entry, search, stock/material filters, CSV export and the activity journal are available.

## Verification

| Check | Evidence / result |
| --- | --- |
| Automated tests | 21 passing tests across core, backend and connection suites. |
| Opening-stock migration | Setup imports the existing records once. Original inventory and transaction tabs remain intact. |
| Duplicate submission / retry | Replaying a request ID produces one committed event. Reusing it with different content is rejected. |
| Stock protection | The last roll reaches zero; another Use is rejected. Unknown products cannot be deducted. |
| Code identity | Barcode / SKU aliases match exactly. A code cannot be linked to two products. Ambiguous text matches require selection. |
| Data validation | Brand/material/colour and sensible weight/diameter are required; server deltas are fixed at +1 or -1. |
| Owner access | Server rejects non-owner identities. Production Apps Script executes as the accessing user and is restricted to Only myself. |
| Window messaging | Expected Google origin, random launch channel, pinned responding window and request IDs are checked. Replies from a different window cannot complete a save. |
| Output safety | Inventory, OCR and user text are rendered through DOM text APIs. CSV and Sheet cells neutralise formula-like text. |
| Journal integrity / growth | Reconciliation errors are surfaced rather than displayed as empty stock. Journal capacity and inventory filter range expand with data. |
| Phone layout | Checked at a 390 px browser viewport (375 px content width with scrollbar): no horizontal page overflow. |
| Add / Use UI | Confirmed in isolated fixture mode and against the real private Google Sheet. Buttons disable while saving. |
| Scan another | Fixture browser test saved one roll, retained Add mode, incremented the session tally, and reset the previous detection. |
| Live persistence | A real +1 followed by -1 was saved through the deployed app; original stock was restored and both events appeared in the activity log. |
| Page refresh | The connected app reconnected and loaded the saved stock after a browser refresh. |
| Publication | Public GitHub repository and HTTPS GitHub Pages site deployed. Private backend version 10 deployed. |

Run the automated audit with:

```sh
node --test tests/core.test.mjs tests/backend.test.mjs tests/bridge.test.mjs
```

The backend tests use a mock of Google services and exercise the actual Apps Script source. The browser fixture is explicitly labelled and makes no real Sheet writes. Live persistence was separately checked through the production Google connection; fixture results are not presented as live-provider tests.

## Tests with the supplied photographs

The material-label photo produced Bambu Lab, PLA Basic, Red and filament code 10200. OCR did not reliably read weight or diameter from that photograph. The app disclosed the 1,000 g / 1.75 mm defaults for the user to verify.

The angled barcode-label photo produced the printed barcode identifier and SKU text. The numeric identifier passed EAN-13 checksum validation. Barcode-symbol decoding did not succeed on that particular angled photograph; the app used its printed-number OCR fallback. The app correctly required material details for this unfamiliar code and did not enable saving incomplete product information.

The photographs were processed in the browser. They were not copied into the repository or uploaded to an OCR service.

## Deployment / security decisions

- The normal GitHub Pages app is the camera frontend. Google Sheets stays private.
- Google rejected an externally embedded private connection in the live deployment. The released connection uses a normal signed-in Google tab, which opens the scanner tab. Keep the Google tab open in the background.
- The Sheet ID and owner identity are private Google Script Properties. The connection URL is learned at runtime and saved only in the user's browser. No private Sheet/deployment identifiers, API credentials or photos are in the public source.
- The append-only Tracker Journal is authoritative. Tracker Inventory is the readable view. The original tabs remain as a migration baseline.
- Local pending-request storage prevents a lost response from becoming an unchecked repeat scan. Check save / Retry is available inside the scanner and on the main page.
- A new device starts at the private Google connection link and chooses Open connected app. Signing in and reviewing Google's permissions remain the account owner's actions.

## Remaining verification limits

- A physical phone camera and its permission prompt were not exercised. Live camera code and secure-context/error handling are implemented; the supplied-photo path was tested on real images. The first phone run remains a device/browser acceptance check.
- Recognition is a suggestion. Check the material, colour, SKU and spool/refill format before confirming. OCR can confuse similar characters; a valid numeric checksum does not establish product identity by itself.
- The app tracks whole rolls in storage, not grams consumed during printing.
- Do not manually edit generated journal balances. It is a small personal inventory service, not a load-tested multi-user warehouse system.
- This audit is a code, behaviour and deployment review, not an independent penetration test or a guarantee of recognition accuracy on every label.
