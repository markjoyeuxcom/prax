# Capture-window shadow review — 71e9f7f

## Verdict

**Approve merging 71e9f7f and cutting `v0.21.0-rc.3`.** The diagnosis is consistent with the installed Tauri 2.11.5, tauri-runtime-wry 2.11.4, Tao 0.35.3, and Wry 0.55.1 source: the transparent, undecorated capture window still has Tao’s default macOS `has_shadow: true`, and macOS draws that shadow for the complete 640×128 NSWindow frame. `.shadow(false)` is the correct and complete code-level fix for that ghost slab. A packaged macOS visual smoke remains desirable, but its absence does not reveal a source-level blocker.

Reviewed `fix/capture-window-shadow` at `71e9f7f32b822934303e4987ae7ae083ce560e29`, one commit on `133af60`. The worktree was clean and no tracked files were changed.

## 1. Diagnosis and implementation

The capture builder is at `src-tauri/src/lib.rs:605-622`. It uses `decorations(false)`, `transparent(true)`, and now `shadow(false)` at line 617. The main-window builder at lines 501-514 has no shadow or transparency change, so the main window is unaffected.

The local dependency source confirms the behavior:

- Tauri’s `WebviewWindowBuilder::shadow` delegates to the runtime (`tauri-2.11.5/src/webview/webview_window.rs:602-614`). Its documentation says Linux is unsupported.
- `tauri-runtime-wry-2.11.4/src/lib.rs:1151-1161` applies the setting to Windows undecorated shadows and, on macOS, Tao’s `with_has_shadow(false)`; it does nothing on Linux.
- Tao’s macOS window attributes default `has_shadow` to true (`tao-0.35.3/src/platform_impl/macos/window.rs:103-122`). During construction, `has_shadow == false` calls `NSWindow.setHasShadow(false)` (`:328-330`), and the runtime methods map directly to `hasShadow`/`setHasShadow` (`:1660-1667`). This is the right construction-time control; no separate invalidation call is required.

The page retains its own intended visual shadow: `public/capture.html:17-22` makes `html, body` transparent and gives `.bar` a 12px radius and CSS `box-shadow`. Turning off only the native window shadow leaves that bar shadow intact.

The fix is scoped to the capture window. It does not touch `tauri.conf.json`, CSP, navigation guards, the main window, or the capture URL. There is no source evidence of a need to set a window background color: doing so would risk reintroducing an opaque rectangle, while Wry’s transparent path already handles the webview background.

## 2. Platform effects and remaining limits

On macOS, the change removes the NSWindow shadow for the capture frame while preserving the CSS bar shadow. It does not alter the main window, because that builder is separate and unchanged.

On Linux, the Tauri runtime’s `shadow` implementation is a compile-time no-op (`tauri-runtime-wry-2.11.4/src/lib.rs:1151-1161`), and Tauri documents shadow as unsupported there. The existing transparent WebKitGTK path remains unchanged; this line introduces no Linux behavior beyond compiling safely. The requested build on this machine validates the Linux-targeted Rust code path, but I did not run a Linux compositor or packaged visual test.

On Windows, although out of this review’s main focus, Tauri documents `shadow(false)` as affecting undecorated-window shadows; this capture window is already undecorated. No Windows build was requested or run.

A subtle runtime point is safe: the capture window is created by this code path and `.shadow(false)` is applied before `.build()`. There is no need to call `set_shadow(false)` later or invalidate `hasShadow`. An already-created window from an older binary would only exist in the old process; upgrading/restarting the app creates it with the new builder.

## 3. Changelog and desktop documentation

The changelog entry is accurate and specific at `CHANGELOG.md:413-419`: it distinguishes the old opaque surface from the rc.2 transparent-window shadow and states that the bar’s CSS shadow remains the only shadow. It is correctly under the `[0.21.0]` `### Fixed` section.

`docs/desktop/BUILD.md:109-119` matches the implementation: transparent HTML/window, macOS private API feature/configuration, no native window shadow, and CSS shadow retained. It does not claim Linux has a native shadow behavior that the runtime does not provide.

The only limitation is evidentiary wording: both documents describe the visual outcome, while this review could not launch a packaged macOS build to inspect pixels. The source and dependency behavior support the diagnosis, and the commit message itself records that packaged visual confirmation is still needed.

## Implemented

No product or tracked-file changes. Produced this read-only review only.

## Tested

| Command | Result |
|---|---|
| `git rev-parse HEAD` | `71e9f7f32b822934303e4987ae7ae083ce560e29` |
| `git status --short` | Empty before review and after checks |
| `/Users/markjoyeux/.cargo/bin/cargo fmt --check` | Exit 0; no formatting differences |
| `/Users/markjoyeux/.cargo/bin/cargo build` (in `src-tauri`) | Exit 0; `Finished dev profile [unoptimized + debuginfo]` |
| `/Users/markjoyeux/.cargo/bin/cargo test --lib` (in `src-tauri`) | Exit 0; **7 passed, 0 failed, 0 ignored** |
| `git show --check HEAD` | Exit 0; no whitespace errors |

The shell’s bare `cargo` lookup initially returned `command not found`; the configured mise-managed binary at `/Users/markjoyeux/.cargo/bin/cargo` was used for the requested commands and passed.

## Unable to test

- Packaged macOS visual appearance and actual NSWindow compositing were not run in this environment.
- Linux WebKitGTK compositor behavior and a Windows packaged build were not run.

**Final decision: approve merging 71e9f7f and then cutting/pushing `v0.21.0-rc.3`, with packaged macOS visual smoke confirmation as a release follow-up.**
