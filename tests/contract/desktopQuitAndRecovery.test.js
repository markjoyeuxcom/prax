import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Two confirmed desktop defects (2026-09-22):
// - A sidecar crash with the window open destroyed "main" and rebuilt it in
//   the same main-thread turn. destroy() is deferred, so the build failed with
//   WindowLabelAlreadyExists and the app was left with no window at all.
// - macOS ⌘Q used Tauri's default menu, whose Quit sends NSApp terminate:.
//   That reaches RunEvent::Exit without ExitRequested, and Exit SIGKILLed the
//   sidecar, leaving the database open with an un-checkpointed WAL.

const rust = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const splash = readFileSync(new URL('../../src-tauri/splash/splash.js', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('../../scripts/verify-desktop-runtime.mjs', import.meta.url), 'utf8');

function functionBody(name) {
  const start = rust.search(new RegExp(`\\nfn ${name}\\b`));
  assert.ok(start > -1, `${name} is present`);
  const end = rust.indexOf('\n}\n', start);
  return rust.slice(start, end);
}

test('a crash after startup shows recovery in the open main window instead of rebuilding it', () => {
  assert.doesNotMatch(rust, /\.destroy\(\)/, 'no window is destroyed and rebuilt under the same label');
  assert.doesNotMatch(rust, /\.eval\(/, 'the recovery reason is never injected as script');
  const recovery = functionBody('show_recovery');
  assert.match(recovery, /get_webview_window\("main"\)/);
  assert.match(recovery, /\.navigate\(url\)/);
  assert.match(recovery, /recovery_url\(heading, &detail\)/);
  assert.match(recovery, /get_webview_window\("capture"\)[\s\S]*?\.hide\(\)/, 'the dead capture bar is hidden');
  assert.match(functionBody('build_main_window'), /Err\(error\) => \{\s*log_shell_event\(/, 'window build errors are logged');

  // Close-to-exit once recovery is showing, whichever way the window got there.
  const build = functionBody('build_main_window');
  assert.match(build, /recovery_shown\s*\.load\(Ordering::SeqCst\)\s*\{\s*app\.exit\(0\);\s*\} else \{\s*api\.prevent_close\(\);/);

  // The page renders the reason from its own query string, as text only.
  assert.match(splash, /new URLSearchParams\(location\.search\)/);
  assert.match(splash, /textContent = recovery\.get\('heading'\)/);
  assert.match(splash, /textContent = recovery\.get\('detail'\)/);
  assert.doesNotMatch(splash, /innerHTML|insertAdjacentHTML|document\.write/);
});

test('every quit path closes the sidecar gracefully before the process ends', () => {
  assert.match(rust, /RunEvent::Exit => finish_server_before_exit\(app\)/);
  const barrier = functionBody('finish_server_before_exit');
  assert.match(barrier, /child\.write\(b"shutdown\\n"\)/);
  assert.match(barrier, /wait_for_termination\(SHUTDOWN_TIMEOUT\)/, 'the main-thread wait is bounded');
  assert.match(barrier, /force_kill_server\(app\)/, 'force-kill remains the bounded fallback');

  // macOS: the app menu replaces the default one, whose Quit skipped ExitRequested.
  assert.match(rust, /\.menu\(app_menu\)\s*\.on_menu_event\(\|app, event\| on_app_menu_event\(app, event\.id\(\)\.as_ref\(\)\)\)/);
  const menu = functionBody('app_menu');
  assert.match(menu, /MenuItem::with_id\(\s*handle,\s*APP_MENU_QUIT,[\s\S]*?Some\("CmdOrCtrl\+Q"\)/);
  assert.doesNotMatch(menu, /PredefinedMenuItem::quit/);
  // Parity with Tauri's default macOS menu; Edit is what gives webview text
  // fields undo, cut, copy, paste and select-all.
  for (const item of ['about', 'services', 'hide', 'hide_others', 'close_window', 'undo', 'redo', 'cut', 'copy', 'paste', 'select_all', 'fullscreen', 'minimize', 'maximize']) {
    assert.match(menu, new RegExp(`PredefinedMenuItem::${item}\\(`), `the app menu keeps ${item}`);
  }
  assert.match(menu, /WINDOW_SUBMENU_ID/);
  assert.match(menu, /HELP_SUBMENU_ID/);
  assert.match(functionBody('on_app_menu_event'), /begin_server_shutdown\(app\.clone\(\), AfterShutdown::Exit\(0\)\)/);
});

test('the packaged smoke drives the menu quit, terminate and crash paths', () => {
  assert.match(rust, /Some\("menu-quit"\) => Ok\(SmokeExit::MenuQuit\)/);
  // terminate: must arrive from AppKit's run loop, as the Dock's does. Sent
  // directly inside run_on_main_thread it deadlocks on tao's handler lock.
  assert.match(rust, /performSelector_withObject_afterDelay\(sel!\(terminate:\), None, 0\.0\)/);
  assert.doesNotMatch(rust, /\.terminate\(None\)/);
  assert.match(smoke, /'--desktop-smoke-exit', 'terminate'/);
  assert.match(smoke, /'--desktop-smoke-exit', 'crash'/);
  assert.match(smoke, /PRAX_DESKTOP_SMOKE recovery-shown/);
  assert.match(smoke, /prax\.db-wal/);
});
