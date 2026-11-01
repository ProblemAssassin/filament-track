# FilamentTrack

A mobile-first filament inventory app. **Add Filament** and **Use Filament** set the mode. Each accepted scan counts exactly one roll. **OK** saves and finishes; **Scan another box** saves and continues in the same mode.

## Run

Node.js 22 or later; no package installation is needed.

```sh
node tests/serve.mjs
node --test tests/*.test.mjs
```

For isolated UI tests, use `node tests/serve.mjs --fixture`. The header says **QA fixture · no Sheet writes**. That mode substitutes mock modules only in the local server; GitHub Pages always serves the real modules. `tests/scanner-harness.html` tests recognition on a selected local image without changing inventory.

## Storage and authentication

- GitHub Pages serves the interface over HTTPS.
- The existing Apps Script project supplies an authenticated Sheets connection tab. Keep its deployment set to **User accessing the web app / Only myself**. Google does not allow this private connection to be embedded reliably, so the Google page opens a connected frontend tab. **Keep the Google connection tab open in the background while scanning.** No cookie/security settings need to be weakened.
- The server additionally checks the owner email stored privately in Script Properties by `setupTracker`. The Sheet ID is also a private Script Property. Each device stores its Google connection URL in browser storage. There are no private Sheet/deployment identifiers, OAuth secrets or bearer keys in this repository.
- The Google Sheet remains private. The app and repository being public does not grant access to inventory.
- The bridge validates message origins, a random per-load channel, and the responding window. The server permits only bounded inventory reads, receipt lookup, and one-roll mutations.
- Browser storage retains only an unresolved transaction request, so a network interruption can be checked or retried with the original request ID. Stock is never treated as saved without a server receipt.

## Google setup / updates

1. Preserve a backup of the existing Apps Script files and retain the current deployment ID.
2. Copy `apps-script/Code.gs` and `apps-script/Index.html` into the existing project.
3. In Apps Script → Project settings → Script properties, set `TRACKER_SHEET_ID` to the private Sheet ID. Set the public `TRACKER.appOrigin` and `TRACKER.appUrl` for the chosen frontend.
4. Run `setupTracker` once in the Apps Script editor and review Google's permissions. It stores the owner identity, imports opening stock, and creates **Tracker Journal** and **Tracker Inventory** inside the existing workbook. It does not delete or modify **Filament Inventory** or **Transaction Log**. Re-running setup does not import opening stock twice.
5. Manage deployments → Edit → New version → Deploy, retaining **User accessing the web app / Only myself**.
6. Open the deployment's private `/exec` URL, sign in to the owning Google account if prompted, then choose **Open connected app**. The connection URL is passed only to the authenticated client and retained in that browser; it is never part of the public source.
7. Keep the Google tab open in the background. Bookmark the Google connection URL as your starting point. The frontend's connection panel also lets you paste that URL on a new device and choose **Choose Google account & connect**. It opens Google's account chooser before the private connection. Copied `/u/5/` paths and `authuser` parameters are removed because account indexes differ between browsers. Select the account that owns this inventory; choosing another account does not grant it access. No deployment token, third-party-cookie exception or public Sheet is needed.

Google documents that Apps Script can fail with multiple signed-in accounts. The account chooser helps select the intended account but cannot guarantee a fix for Google's multi-login limitation. If Google still displays “unable to open the file”, open the private connection URL in a Chrome Incognito tab and sign in only to its owning account. See [Google's troubleshooting guide](https://developers.google.com/apps-script/guides/support/troubleshooting#issues_with_multiple_google_accounts).

**Tracker Journal is authoritative.** Each event stores a product snapshot, a fixed +1 or −1 delta, the resulting balance, and a unique request ID. Locking prevents overlapping stock mutations; replaying the same request cannot append a second event. **Tracker Inventory** is the readable materialised view. Do not manually edit the journal or its generated balances. Original tabs remain as a preserved migration baseline.

## Saving and recovery

Normal confirmation makes one save request and waits for its matching receipt. If the response is delayed, **Finish / check save** sends the original transaction ID in one call: the server returns the existing receipt or completes that same operation. It cannot count the roll twice. A late confirmation received within five minutes of a timeout is accepted automatically while this app remains open. Pending requests remain in browser storage if the page closes or the response arrives later.

After six seconds, the app shows whether the Google tab acknowledged the request (updated Google launcher required). **Go to Google connection** attempts to focus the existing Google tab; switch to it manually if your phone blocks this. Mobile browsers can pause background tabs. The app continues to require a server receipt before displaying a roll as saved.

The optimised Apps Script source reconciles the journal once under its lock, applies the confirmed append in memory, and updates inventory values in one batch. Header formatting, column sizes and filter setup run during setup or when needed for new products. **This backend optimisation requires deploying the updated Apps Script files; the live private backend is still version 10 until that deployment is completed.**

## New barcode → material label

1. Tap **Add Filament** or **Use Filament** and scan a box barcode.
2. An unfamiliar barcode with incomplete details shows **Scan material label**. The barcode stays attached to this roll; this step does not change stock.
3. Scan the printed material label on the same box, or take/upload its photo. This step reads text without stopping again on a barcode. Material, colour and brand fill in for review; already-read SKU, weight, diameter and refill format are retained when absent from the next label. **Read label again** / retaking the label keeps the original barcode. Manual entry remains available.
4. Review the result, then **OK** or **Scan another box** saves the barcode link and exactly one roll together. Subsequent scans of that saved barcode identify the filament directly. In Use mode the label must match an existing product with stock; an unknown product cannot be deducted.

If a label matches an existing filament whose barcode is empty, confirmation links the code to that product. A different barcode already attached to that product is surfaced for correction rather than silently replaced. Recognition remains a suggestion and can need manual corrections.

## Recognition

- Live camera uses the rear camera when available. Barcode decoding and periodic OCR read frames; detection holds a still image for review.
- The photo path supports native camera capture or selecting an image. Large images are downscaled and internally located paper labels are cropped; alternate orientations are tried.
- OCR runs in the browser with Tesseract.js. Photos are not sent to Google Sheets or an image-recognition service. The OCR engine/language downloads pinned runtime assets from jsDelivr and Project Naptha on first use.
- Barcode and SKU aliases match exactly. An unfamiliar code can be associated with the material details after review. Product identity includes brand, material, colour, weight, diameter, and spool/refill format.
- Printed EAN-13 digits read by OCR must pass their checksum. A checksum is not proof of product identity; review still applies.
- OCR suggestions can be incomplete or incorrect. Missing weight and diameter use clearly disclosed defaults for review. Unknown products cannot be used/deducted.
- Live camera behaviour still depends on the device, browser and user permission. HEIC images depend on browser decoder support; JPEG/PNG are the reliable photo options.

## Auditing

Tests cover opening-balance migration, idempotency, zero-stock protection, owner access, alias conflicts, request-ID misuse, journal reconciliation, CSV formula injection, label parsing and ambiguous matches. See `AUDIT.md` for observed browser and deployment verification, with fixture and live tests distinguished.

## Dependencies

Vendored client scripts: `@zxing/library` 0.21.3 (Apache-2.0) and `tesseract.js` 6.0.1 (Apache-2.0). Licences are under `vendor/`. OCR worker/core/language assets load on demand as documented above. No paid OCR API is configured.
