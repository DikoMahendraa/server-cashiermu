# CashierMu — Development Notes & Issue Log

Learning documentation: a collection of issues found, their root causes, and how they were resolved.
Useful as a reference for future projects.

---

## 1. Expo Dev Client Setup on Xcode 26 / Swift 6.2

### Problem
`npx expo run:ios` fails to compile because Xcode 26 uses Swift 6.2, which enforces two new, stricter rules:
1. **SE-0430 Region-based Sending:** `nonisolated(unsafe) let` inside a closure may not capture a pointer that is sent across a concurrency boundary.
2. **`SWIFT_RETURNS_RETAINED` is rejected on `SWIFT_SHARED_REFERENCE` types.**

The errors appear in `expo-modules-jsi@57.1.1`, which has not yet been updated for Swift 6.2.

### Root Cause
The `expo-modules-jsi` library enables upcoming Swift features that aggressively enforce Swift 6 concurrency rules:
- `NonisolatedNonsendingByDefault`
- `InferIsolatedConformances`

In Swift 6.2, these two features interact with `RuntimeScheduler.h` and `JavaScriptRuntime.swift` and produce compile errors.

### Solution
Patch `node_modules` via `patch-package`:
1. `RuntimeScheduler.h`: Remove `SWIFT_RETURNS_RETAINED` from both constructors.
2. `Package.swift`: Remove the two `enableUpcomingFeature` calls.
3. `JavaScriptRuntime.swift` (3 sites): Replace the `nonisolated(unsafe) let x = x` pattern with a `NonisolatedUnsafeVar<T>` wrapper.
4. `ios/Podfile`: Add a `post_install` hook that sets `SWIFT_STRICT_CONCURRENCY = 'minimal'`.

### Lesson Learned
- When updating Xcode to a new major version (especially one that brings a new Swift version), check whether native libraries already support it.
- `patch-package` + a `postinstall` hook is a pragmatic way to patch `node_modules` so the patch survives `npm install`.
- Do not upgrade Xcode to a new major version close to a production deadline without testing first.

---

## 2. Metro Crash: Cannot find module 'react-native-reanimated/plugin'

### Problem
After `react-native-reanimated` was removed from the project (because it caused the app to crash), the Metro bundler failed to start with this error:
```
Cannot find module 'react-native-reanimated/plugin'
```

### Root Cause
`nativewind` uses `react-native-css-interop` as a Babel transformer. Its `babel.js` has a hardcoded entry:
```js
plugins: [
  require("./dist/babel-plugin").default,
  ["react-native-reanimated/plugin"],  // ← this one
  ...
]
```
This is loaded when Metro initializes the Babel transform, not when a file imports reanimated. So even though no code uses reanimated, Metro still crashes.

### Solution
Patch `react-native-css-interop/babel.js` via `patch-package` to remove the `"react-native-reanimated/plugin"` line.

After the patch:
```
npx expo start --clear   # --clear is required to reset the Babel cache
```

### Lesson Learned
- `nativewind@4` requires `react-native-reanimated`. If you do not want to use reanimated, downgrade to `nativewind@2`, which does not have this dependency, or find an alternative animation library that is not required by CSS interop.
- Always run with `--clear` after changing the Babel config/plugins — Metro caches Babel transforms aggressively.
- `npx expo start` ≠ `npx expo run:ios`:
  - `expo start` = runs only the Metro bundler (for JS-only changes, using a dev client that is already installed)
  - `expo run:ios` = compiles native code + installs to the device + runs Metro

---

## 3. The "Cetak Ulang" (Reprint) Button Does Nothing

### Problem
The "Cetak Ulang" (Reprint) button in `TransactionDetailScreen` does nothing when pressed.

### Root Cause
The button has no `onPress` handler. There is a `TouchableOpacity`, but no function is attached to it.

### Solution
Implement `handleReprint`:
1. Check `printerService.isConnected()` — show an informative `Alert` if the printer is not connected.
2. Set a `loading` state to disable the button and show a spinner.
3. Call `printerService.print(transaction, storeProfile...)`.
4. Catch errors and show an `Alert`.

### Lesson Learned
- Always pass all the context the printer service needs: `storeName`, `storeAddress`, `storePhone`, `receiptHeader`, `receiptFooter`.
- This change is JS-only → no native rebuild needed, just reload Metro.

---

## 4. Printer Status in SettingsScreen Does Not Update

### Problem
After successfully connecting a printer from `PrinterSettingsScreen`, `SettingsScreen` still shows the status "Tidak Terhubung" (Not Connected).

### Root Cause
`SettingsScreen` reads `hardwareSettings.printer?.status` from the **Zustand store**. But `PrinterSettingsScreen.handleConnect()` only calls `printerService.connect()`, which saves the address to `AsyncStorage` and establishes the BLE connection — it never updates the Zustand store.

Two sources of truth that are out of sync:
- `printerService` (the actual BLE connection, a singleton)
- Zustand `hardwareSettings.printer` (UI state)

### Solution
In `PrinterSettingsScreen`:
- After a successful `connect` → `updateHardwareSettings({ printer: { address, name, paperWidth, status: 'connected', lastConnectedAt } })`
- After a successful `disconnect` → `updateHardwareSettings({ printer: null })`

### Lesson Learned
- Services/singletons that manage hardware (BLE, scanner, etc.) must be bridged to state management (Zustand) explicitly — they do not sync automatically.
- A good pattern: after a hardware action succeeds, always update the UI state store.

---

## 5. Blank Receipt (BLE Thermal Printer)

### Problem
After a print is commanded, the printer receives the data and the paper advances (paper feed runs), but no text is printed at all.

### Root Cause
`printer.service.ts` calls `.codepage(CODEPAGE.CP850)` (later changed to `CP437`), which sends the byte sequence `[0x1B, 0x74, 0x00]` to the printer.

The cheap 58mm thermal printers widely sold on the market have incomplete ESC/POS implementations. When they receive `ESC t 0x00`:
- The `0x00` (null) byte after `0x74` is interpreted as null/end-of-stream or as a parameter of an unknown vendor-specific command.
- The printer enters an **undefined parsing state** and treats all subsequent bytes as parameters of the command being parsed.
- All text commands (`line()`, `bold()`, `align()`) are ignored.
- `feedToTear` (`ESC d 18`) is still executed because some printers handle feed commands independently in firmware → the paper advances but no text appears.

Investigating the library source (`escpos.ts`) also revealed that `EscPosBuilder.text()` encodes with `encodeCodepage850` by default — inconsistent with the `codepage(CP437)` that was set. However, this is irrelevant for Indonesian text because all its characters are ASCII (byte values 0-127 are identical in CP437 and CP850).

### Solution
Remove the `.codepage()` call entirely:
```ts
// BEFORE
const b = new EscPosBuilder().init().codepage(CODEPAGE.CP437);

// AFTER
const b = new EscPosBuilder().init();
```

### Lesson Learned
- **"Paper feeds but no text" = the printer is confused by a command.** This is the signature of an unsupported codepage command. Isolate it by removing commands one at a time.
- Cheap Chinese thermal printers (unbranded, OEM 58mm) often have a very limited ESC/POS subset. Do not assume all standard commands are supported.
- For text that is entirely ASCII (Indonesian, English, digits, basic symbols), there is no need to set a codepage at all — the printer's factory default is enough.
- `ESC t 0x00` is a dangerous byte sequence on many printers. Prefer not to send it unless the printer is known to support codepage selection.
- Always debug with a **minimum viable receipt** (just one line of text + feed) before adding complex formatting.

---

## 6. Payment Fails: "A record with this value already exists"

### Problem
Every time payment confirmation is pressed, the transaction fails with this error message:
```
Pembayaran Gagal — A record with this value already exists
```
The backend log shows: `Unique constraint failed on the fields: (invoiceNumber)`, Prisma error code `P2002`.

### Root Cause

**FE — Double Submit:**
The payment confirmation button uses `disabled={!canPay}` where `canPay = isCashOk` (it only checks that the cash is sufficient). The `loading` state is not part of the disable condition. A user who taps the button twice quickly can send two requests before React re-renders with `loading: true`.

**BE — Invoice Number Is Not Atomic (COUNT-based race condition):**
```ts
// utils/invoice.ts — PROBLEMATIC
const count = await prisma.transaction.count({ where: { branchId, createdAt: ... } });
const seq = String(count + 1).padStart(4, '0');
return `INV-${dateStr}-${seq}`;
```
`COUNT` → `+1` → `INSERT` are three separate, non-atomic operations. Two simultaneous requests read the same `count` → generate the same `invoiceNumber` → the second one hits P2002.

**BE — Cross-Branch Collision (Systematic, not just concurrent):**
`invoiceNumber @unique` is **global** in the Prisma schema. But the count is filtered per `branchId`. If Branch A and Branch B each create their first transaction today, both generate `INV-20261004-0001` → a collision is guaranteed (not only when concurrent).

**BE — Retry Is Ineffective Because COUNT Does Not Change:**
The initial fix added a retry loop (max 3x) that catches P2002 and regenerates. However, because `generateInvoiceNumber` uses COUNT, and a failed INSERT is rolled back (does not change the count), every retry produces an **identical invoice number** → all 3 attempts fail → it still returns 409.

### Solution

**FE:** Add `|| loading` to the disabled prop:
```tsx
// BEFORE
disabled={!canPay}

// AFTER
disabled={!canPay || loading}
```

**BE — Replace COUNT with MAX:**
```ts
// utils/invoice.ts — FIXED
const last = await prisma.transaction.findFirst({
  where: {
    storeId,              // ← scope to store, not branch
    invoiceNumber: { startsWith: prefix },  // ← filter by prefix, not createdAt
  },
  orderBy: { invoiceNumber: 'desc' },
  select: { invoiceNumber: true },
});

let seq = 1;
if (last) {
  const lastSeq = parseInt(last.invoiceNumber.slice(prefix.length), 10);
  if (!isNaN(lastSeq)) seq = lastSeq + 1;
}
```

Why MAX-based is more robust than COUNT-based:
- MAX reads records that are **already committed** → unaffected by rollbacks
- Filtering per `storeId` → no cross-branch collisions within one store
- Filtering by `startsWith prefix` (instead of `createdAt`) → immune to timezone mismatch (server UTC vs local)
- The retry loop is kept to handle concurrent requests that slip through (very rare but still possible)

### Lesson Learned
- **Do not use COUNT + 1 to generate a unique sequential ID** — this is a classic race-prone anti-pattern. Use MAX of the existing values, a database sequence (`SERIAL`, `NEXTVAL`), or a UUID.
- **The unique constraint must be consistent with the generation scope:** if `invoiceNumber @unique` is global, then generation must also be global (scoped to storeId at minimum), not per sub-entity (branchId).
- **A retry that regenerates from the same input is a useless retry.** Make sure the retry actually produces a different value, not the same one.
- Always disable the submit button while `loading` is active — pattern: `disabled={!canSubmit || isLoading}`.
- Filtering database queries on a field that stores the value (the invoice number prefix) is more robust than filtering on a timestamp, which can hit timezone issues.

---

## Summary of Patterns & Best Practices

| Area | Anti-Pattern | Best Practice |
|------|-------------|---------------|
| Sequential ID | `COUNT + 1` | `MAX of the last value + 1` or a DB sequence |
| Unique scope | Global unique, generate per subset | Generation scope = unique constraint scope |
| Retry | Retry with the same input | Make sure the retry produces a different value |
| UI Submit | `disabled={!canSubmit}` | `disabled={!canSubmit \|\| isLoading}` |
| Hardware ↔ UI State | Read directly from the service | Sync to state management (Zustand) after a successful action |
| ESC/POS Debugging | Send full formatting right away | Test with a minimal receipt first, then add commands one at a time |
| node_modules patch | Edit directly (lost on reinstall) | `patch-package` + `postinstall` hook |
| Metro cache | Plain restart | `npx expo start --clear` after changing the Babel config |
