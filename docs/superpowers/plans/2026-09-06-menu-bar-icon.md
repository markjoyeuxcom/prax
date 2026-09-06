# Replace the filled menu-bar tile

1. Reproduce the alpha-mask defect with a native test of the selected tray image.
2. Render a transparent Prax mark from its vector source and embed it only for the
   macOS tray. Preserve the existing Dock icon and tray menu behavior.
3. Run native tests, compile the app, run isolated lifecycle smoke checks, and
   inspect its menu-bar appearance. Run the required Node/syntax checks.
4. Record results and readiness limits below.

Regenerate the committed PNG after editing the SVG:

```sh
node scripts/build-tray-icon.mjs
```

This uses the project's installed Playwright browser; set `PLAYWRIGHT_BROWSERS_PATH`
if that browser is installed outside the default cache.

## Verification

- The native alpha-mask regression failed against the old filled app icon with
  `menu-bar template must leave most of its pixels transparent`.
- After embedding the dedicated PNG, `mise exec -- cargo test --manifest-path
  src-tauri/Cargo.toml` passed **7 tests**.
- `mise exec -- cargo build --manifest-path src-tauri/Cargo.toml` built the native
  debug executable. Rust formatting and `npm run desktop:verify` passed.
- `npm test`: **1,873 passed, 0 failed, 0 skipped**. `npm run check` passed;
  the new renderer also passed `node --check`.
- The vector mark was visually inspected at menu-bar size and enlarged on light
  and dark backgrounds. Its full-colour Dock counterpart is unchanged.
- `npm run desktop:smoke -- --binary src-tauri/target/debug/prax` passed after the
  live app was closed: two launches preserved data across 26 migrations and the same
  browser-storage origin, with clean shutdowns.
- Direct native menu-bar GUI inspection was unavailable: CUA failed to start and
  macOS denied System Events access. The generated mark's appearance was inspected
  separately on light/dark backgrounds; native lifecycle verification passed.

Readiness checks on the combined editor branch also passed: **113 Chromium browser
tests**, **7/7 retrieval cases**, **zero npm audit vulnerabilities**, 200-task/150-item
portable round-trip, and large/current plus historical backup/restore through the
current migration with integrity/FK validation and production boot.
