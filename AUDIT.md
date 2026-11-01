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
| Automated tests | 42 passing tests across core, backend, connection, account-routing and scan-flow suites. |
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
| Publication | Public GitHub repository and HTTPS GitHub Pages site deployed. Private backend version 11 deployed. |

Run the automated audit with:

```sh
node --test tests/*.test.mjs
```

The backend tests use a mock of Google services and exercise the actual Apps Script source. The browser fixture is explicitly labelled and makes no real Sheet writes. Live persistence was separately checked through the production Google connection; fixture results are not presented as live-provider tests.

## Tests with the supplied photographs

The material-label photo produced Bambu Lab, PLA Basic, Red and filament code 10200. OCR did not reliably read weight or diameter from that photograph. The app disclosed the 1,000 g / 1.75 mm defaults for the user to verify.

The angled barcode-label photo produced the printed barcode identifier and SKU text. The numeric identifier passed EAN-13 checksum validation. Barcode-symbol decoding did not succeed on that particular angled photograph; the app used its printed-number OCR fallback. The app correctly required material details for this unfamiliar code and did not enable saving incomplete product information.

A separate clean QR fixture was decoded by the actual browser barcode reader to its known test value. This verified the symbol-decoder path independently of OCR; it did not change inventory.

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

## Account-routing update

The frontend connection button now opens Google’s account chooser before continuing to the validated private Apps Script deployment. Pasted `/macros/u/5/s/…/exec` links are accepted and normalized to `/macros/s/…/exec`; query parameters and fragments, including session-specific account hints, are removed. Owner-only backend access remains unchanged. No account identity or deployment identifier was added to public source.

Four additional automated checks cover copied-link normalization, the chooser’s continuation target, rejecting unsafe destinations, and browser storage. This update was verified with automated tests and the published source. The signed-in account chooser and return flow were not browser-tested for this update because local browser control was disabled in Work settings. Google’s documented multi-login limitation can still require an Incognito tab signed in only to the owning account.

## New-barcode label-tagging update

An unfamiliar barcode with incomplete product details now shows a dedicated Scan material label prompt. The original barcode stays attached through live label reading, photo upload and label retakes. The label step bypasses barcode decoding so the same symbol cannot intercept it. Detected fields from the two sides are merged; defaults are applied only for review, not as constraints when matching saved products. Confirmation stores the barcode mapping and the single Add/Use operation together using the existing backend API. Known barcodes proceed directly to verification. Unknown Use products remain blocked. Conflicting saved aliases are surfaced instead of discarded or overwritten.

Eight scan-flow tests exercise the actual app handlers with a lightweight DOM and simulated scanner/bridge callbacks, including new/known codes, label photos, retakes, manual fallback, Use, alias conflicts, package-size mismatches and save/continue. They also exercise the actual scanner’s live-loop and Read label branches with controlled frames/OCR to verify barcode bypass. An additional test exercises the actual backend source against mocked Google services to verify atomic tagging, one-roll accounting and retry idempotency. All 34 automated tests pass. No live inventory was changed for this update. Physical camera behaviour and visual layout of the new prompt still require browser/device verification; local browser control was unavailable. The private backend deployment remains version 10.

## Save-performance update — deployed as version 11

The frontend recovery button now sends the original transaction directly, replacing receipt lookup followed by a separate retry. The existing idempotent backend either returns its saved receipt or commits that same request once. Slow requests display progress after six seconds. Updated launcher source acknowledges receipt immediately so the frontend can distinguish delivery from Google processing. Timed-out mutations retain their message listener for five minutes and can complete automatically on a late valid confirmation. Pending local storage remains the fallback after closure or expiry. Stock is never optimistically marked as saved.

Prepared Apps Script changes remove the second full-journal read after a flushed append, update the reconciled state in memory under the same lock, and skip repeated inventory formatting, column resizing and filter work on ordinary saves. Inventory values remain a single batch write. Setup still configures the view; growth still extends capacity and filters.

Eight additional automated tests cover one journal read and one inventory data write with no layout operations, returned-state equivalence to a fresh journal read, mirror failure, flush failure/replay, progress acknowledgements, late replies, listener expiry, one-call recovery and automatic late completion. All 42 tests pass. These checks use the actual source with mocked Google services or controlled browser adapters. No wall-clock speedup is claimed from mock timings.

The frontend and backend source are published in the repository. On 1 November 2026 at 15:36 SGT, the existing private deployment was successfully updated to version 11, described as FilamentTrack 1.1 - faster saves and request acknowledgements. The app URL stayed the same. Execute as User accessing the web app and Only myself access were verified before deployment. Desktop control worked after the user restarted Chrome, allowing both tested source files to be saved and the deployment completed.

The deployed launcher connected to the private inventory, and its connected frontend loaded the original one-product, one-roll balance. A real Add changed stock 1 → 2; a real Use restored 2 → 1. Both displayed Google received this roll while saving and completed without a separate receipt-check step. Completion was visible by the next observations, approximately 9.2 and 9.3 seconds after initiating each click, including automation/input/observation overhead. These are coarse desktop observation bounds, not precise RPC latency measurements or a before/after speed benchmark. Phone timings remain unmeasured. A journal-backed refresh also confirmed the restored balance. Google cold starts, network latency and phone background-tab suspension remain possible delays.

## Firebase commissioning and barcode/camera correction — 1 November 2026

The personal Firebase frontend is live at `/firebase/`. Google sign-in, the authorised Pages domain, a Standard database in Singapore, owner-only rules and private owner allowlist were configured. The original one-variety / one-roll CSV was imported once and opening import was closed. A live Add and Use each displayed 0.2 seconds for the client-measured committed save; stock was restored to one roll. A reload used the saved account and returned to the dashboard with one roll. The root-link migration and automatic Sheet report remain pending. A prepared Apps Script cutover guard rejects new legacy mutations when `TRACKER_PRIMARY_BACKEND=FIREBASE`, while still returning already-committed receipts; this property/guard is not yet active in the live version-11 backend.

The reported phone screenshot showed stale Starting camera feedback during photo reading. The old barcode fallback also used `decodeFromImageElement`, whose helper can retry checksum/format failures on the same still image. That could prevent the live loop from examining later frames. In addition, automatic text recognition started on the first frame and shared the scanner's busy flag, delaying further barcode checks.

The replacement decoder makes finite synchronous attempts on actual canvas pixels, tries both barcode orientations and detects high-contrast stripe areas before full-frame fallback. Barcode scans and barcode photos never start OCR. An unknown barcode offers Take label photo and retains the original code through review and save. Explicit Read label or a label photo starts OCR. Camera requests use a 1280×720 preference, duplicate starts share a request, startup/preview waits have deadlines, late streams are stopped, and the web camera is stopped before native photo capture. Photo and startup callbacks cannot overwrite each other's status. OCR initialisation and recognition also have deadlines with visible retry/manual errors.

The English model download changed from Project Naptha's 10,923,060-byte full file to the SDK's official 2,952,873-byte compressed LSTM file, with a separate reusable cache key. Sizes were verified from successful HTTP HEAD responses. OCR keeps the existing quality-oriented model rather than switching to an unverified fast model. Label photos try at most two likely orientations and stop once material and colour are available for human review.

69 source-level regression tests passed, including real vendored ZXing decoding of horizontal, vertical and off-centre EAN-13 fixtures; invalid checksum rejection; finite failed-frame scanning; barcode-photo OCR bypass; duplicate/cancelled camera starts; a hung preview; stopping before native photo capture; and the reported photo-during-startup state race. Existing transaction, account, label tagging and pending-save checks passed. The ten Firestore emulator/security tests passed earlier; rules were unchanged by this scanner update.

The actual supplied Bambu barcode JPEG decoded as `6975337030270` through the complete updated photo path in about 69 ms on the local desktop, creating zero OCR workers. The material-label JPEG produced PLA Basic, Red, Bambu Lab and filament code 10200 in about 0.9 seconds using a local OCR worker and the newly cached English model. Weight and diameter were not reliably extracted from that noisy full-box image and remain subject to review/default correction. These are local processing measurements, not phone, cold-download or physical-camera benchmarks. User photos and private account/inventory identifiers were not added to the public repository.

## Label weight parsing correction — 1 November 2026

OCR can join a filament colour code to a neighbouring `g` unit. The parser now excludes a number matching an explicitly detected filament/colour code when choosing spool weight, and continues looking for a separate stated weight. A regression test covers a joined code with a separate 1 kg weight, a 750 g weight, and no independent weight. Missing weight still goes through the existing review/default flow. Both app entry points use a new versioned parser import. The 70 source, UI, bridge and report tests pass; database rules are unchanged.
