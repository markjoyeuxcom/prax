// Prax desktop shell (docs/desktop/checklist.md Phase 3).
//
// Lifecycle: let the bundled Node/Fastify sidecar bind an OS-assigned
// localhost port → consume its structured readiness line → probe /readyz →
// open a window locked to that exact origin. Database + bounded logs live
// under the OS app-data dir. The sidecar starts *before* any webview work so
// data-layer liveness never depends on the platform webview initializing.
// Single-instance locking keeps two windows from opening the same database;
// every quit path (tray, app menu, Dock, logout) asks Node to close
// Fastify/SQLite over stdin and uses a bounded force-kill only if the child
// cannot shut down.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem};
use tauri::path::BaseDirectory;
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const READY_PREFIX: &str = "PRAX_DESKTOP_READY ";
// System-wide capture summon. Contended defaults are useless — this chord is
// rarely claimed; registration failure surfaces in the tray tooltip. The
// USER's chord lives in app_settings (fetched after the server is ready);
// this is only the fallback when nothing is stored or the fetch fails.
const CAPTURE_SHORTCUT_DEFAULT: &str = "CmdOrCtrl+Shift+Space";

// The currently registered capture chord, so a settings change can
// unregister it before registering the replacement.
struct CaptureShortcut(Mutex<Option<String>>);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_SERVER_LOG_BYTES: u64 = 5 * 1024 * 1024;

// The bundled startup/recovery page (src-tauri/splash) as Tauri's custom
// protocol serves it; `use_https_scheme` stays off, so Windows uses http.
#[cfg(windows)]
const BUNDLED_ORIGIN: &str = "http://tauri.localhost/";
#[cfg(not(windows))]
const BUNDLED_ORIGIN: &str = "tauri://localhost/";

// The app menu's Quit item (macOS). Tray items share the global menu-event
// listeners, so this id must not collide with theirs.
const APP_MENU_QUIT: &str = "app-quit";

// Diagnostic log for shell-side failures: the sidecar's server.log, so one
// file tells the whole story of a failed launch or crash.
struct ShellLog(PathBuf);

#[derive(Debug, Clone, PartialEq, Eq)]
enum ServerPhase {
    Starting,
    Ready(u16),
    Failed(String),
    Terminated(String),
}

struct ServerProcess {
    child: Mutex<Option<CommandChild>>,
    phase: Mutex<ServerPhase>,
    phase_changed: Condvar,
    expected_stop: AtomicBool,
    shutdown_started: AtomicBool,
    recovery_shown: AtomicBool,
}

impl ServerProcess {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            phase: Mutex::new(ServerPhase::Starting),
            phase_changed: Condvar::new(),
            expected_stop: AtomicBool::new(false),
            shutdown_started: AtomicBool::new(false),
            recovery_shown: AtomicBool::new(false),
        }
    }

    fn set_phase(&self, phase: ServerPhase) {
        *self.phase.lock().unwrap() = phase;
        self.phase_changed.notify_all();
    }

    fn wait_for_ready(&self, timeout: Duration) -> Result<u16, String> {
        let deadline = Instant::now() + timeout;
        let mut phase = self.phase.lock().unwrap();
        loop {
            match &*phase {
                ServerPhase::Ready(port) => return Ok(*port),
                ServerPhase::Failed(detail) | ServerPhase::Terminated(detail) => {
                    return Err(detail.clone())
                }
                ServerPhase::Starting => {}
            }

            let now = Instant::now();
            if now >= deadline {
                return Err(
                    "The local server did not announce readiness within 30 seconds.".into(),
                );
            }
            let (next, result) = self
                .phase_changed
                .wait_timeout(phase, deadline.saturating_duration_since(now))
                .unwrap();
            phase = next;
            if result.timed_out() && matches!(*phase, ServerPhase::Starting) {
                return Err(
                    "The local server did not announce readiness within 30 seconds.".into(),
                );
            }
        }
    }

    fn wait_for_termination(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut phase = self.phase.lock().unwrap();
        while !matches!(*phase, ServerPhase::Terminated(_)) {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let (next, result) = self
                .phase_changed
                .wait_timeout(phase, deadline.saturating_duration_since(now))
                .unwrap();
            phase = next;
            if result.timed_out() && !matches!(*phase, ServerPhase::Terminated(_)) {
                return false;
            }
        }
        true
    }
}

#[derive(Clone, Copy)]
enum AfterShutdown {
    Exit(i32),
    Restart,
}

fn normalize_export_filename(value: &str) -> String {
    let basename = value.rsplit(['/', '\\']).next().unwrap_or_default().trim();
    let mut safe: String = basename
        .chars()
        .filter(|character| !character.is_control())
        .map(|character| {
            if matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '-'
            } else {
                character
            }
        })
        .collect();
    safe = safe.trim().trim_start_matches('.').to_string();
    if safe.is_empty() {
        return "prax-library.zip".to_string();
    }
    if !safe.to_ascii_lowercase().ends_with(".zip") {
        safe.push_str(".zip");
    }
    safe
}

fn persist_export(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The selected export location has no parent folder.".to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Could not prepare the selected export location: {error}"))?;
    temporary
        .write_all(bytes)
        .map_err(|error| format!("Could not write the Library archive: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("Could not finish the Library archive: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("Could not save the Library archive: {}", error.error))?;
    Ok(())
}

// The webview never supplies a filesystem path. This command always obtains
// the destination through the native Save dialog, then atomically replaces it
// from a same-directory temporary file once every archive byte is durable.
#[tauri::command]
async fn save_library_export(
    window: tauri::Window,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    let suggested_name = normalize_export_filename(&file_name);
    let dialog = window
        .app_handle()
        .dialog()
        .file()
        .add_filter("ZIP archive", &["zip"])
        .set_file_name(suggested_name);
    #[cfg(desktop)]
    let dialog = dialog.set_parent(&window);

    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    dialog.save_file(move |selected| {
        let outcome = (|| {
            let Some(selected) = selected else {
                return Ok(None);
            };
            let path = selected.into_path().map_err(|error| {
                format!("The selected export location is not a local file: {error}")
            })?;
            persist_export(&path, &bytes)?;
            Ok(Some(path.to_string_lossy().into_owned()))
        })();
        let _ = sender.send(outcome);
    });

    // Waiting on the callback and writing the archive both stay off the UI
    // event loop. The native macOS sheet must remain fully interactive while
    // this command future is pending.
    let outcome = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| format!("The Library export worker stopped unexpectedly: {error}"))?
        .map_err(|error| format!("The native Save dialog did not return a result: {error}"))?;
    outcome
}

fn http_ready(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(750)));
    let request =
        format!("GET /readyz HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    response.starts_with("HTTP/1.0 200") || response.starts_with("HTTP/1.1 200")
}

fn wait_until_http_ready(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if http_ready(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn parse_ready_line(line: &[u8]) -> Result<Option<u16>, String> {
    let value = String::from_utf8_lossy(line);
    let trimmed = value.trim();
    let Some(payload) = trimmed.strip_prefix(READY_PREFIX) else {
        return Ok(None);
    };
    let Some(port) = payload
        .strip_prefix("{\"port\":")
        .and_then(|value| value.strip_suffix('}'))
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
    else {
        return Err("The local server returned a malformed readiness message.".into());
    };
    Ok(Some(port))
}

fn app_origin(url: &tauri::Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || ((url.scheme() == "http" || url.scheme() == "https")
            && url.host_str() == Some("tauri.localhost"))
}

fn navigation_allowed(url: &tauri::Url, sidecar_port: Option<u16>) -> bool {
    if app_origin(url) {
        return true;
    }
    sidecar_port.is_some_and(|port| {
        url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(port)
    })
}

// The recovery screen is the bundled page with its reason in the query
// string. splash.js renders both fields as text, so nothing in a server
// message or log path is ever evaluated as script.
fn recovery_url(heading: &str, detail: &str) -> tauri::Url {
    let mut url: tauri::Url = BUNDLED_ORIGIN
        .parse()
        .expect("bundled origin always parses");
    url.set_path("/index.html");
    url.query_pairs_mut()
        .append_pair("state", "error")
        .append_pair("heading", heading)
        .append_pair("detail", detail);
    url
}

fn is_recovery_url(url: &tauri::Url) -> bool {
    app_origin(url)
        && url.path() == "/index.html"
        && url
            .query_pairs()
            .any(|(key, value)| key == "state" && value == "error")
}

fn log_shell_event(app: &AppHandle, message: &str) {
    let line = format!("[prax] {message}\n");
    eprint!("{line}");
    let Some(log) = app.try_state::<ShellLog>() else {
        return;
    };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log.0) {
        let _ = set_owner_only(&log.0, 0o600);
        let _ = file.write_all(line.as_bytes());
    }
}

#[cfg(unix)]
fn set_owner_only(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_owner_only(_path: &Path, _mode: u32) -> std::io::Result<()> {
    Ok(())
}

fn rotate_log(path: &Path, max_bytes: u64) -> std::io::Result<bool> {
    let Ok(metadata) = std::fs::metadata(path) else {
        return Ok(false);
    };
    if metadata.len() <= max_bytes {
        return Ok(false);
    }
    let rotated = path.with_extension("log.1");
    if rotated.exists() {
        std::fs::remove_file(&rotated)?;
    }
    std::fs::rename(path, rotated)?;
    Ok(true)
}

fn prepare_data_dir(
    app: &AppHandle,
    override_dir: Option<PathBuf>,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let data_dir = match override_dir {
        Some(path) => path,
        None => app.path().app_data_dir()?,
    };
    let logs_dir = data_dir.join("logs");
    std::fs::create_dir_all(&logs_dir)?;
    set_owner_only(&data_dir, 0o700)?;
    set_owner_only(&logs_dir, 0o700)?;
    Ok(data_dir)
}

fn tighten_database_files(data_dir: &Path) {
    for name in ["prax.db", "prax.db-wal", "prax.db-shm"] {
        let path = data_dir.join(name);
        if path.exists() {
            let _ = set_owner_only(&path, 0o600);
        }
    }
}

fn show_recovery(app: &AppHandle, heading: &str, detail: String) {
    let process = app.state::<ServerProcess>();
    if process.recovery_shown.swap(true, Ordering::SeqCst) {
        return;
    }
    let url = recovery_url(heading, &detail);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        // The capture bar posts to the dead server. Once it is hidden, the
        // next summon finds no sidecar port and surfaces the recovery screen.
        if let Some(capture) = handle.get_webview_window("capture") {
            let _ = capture.hide();
        }
        // A crash after startup reuses the open main window. destroy() only
        // takes effect on a later event-loop turn, so building a replacement
        // "main" here fails with WindowLabelAlreadyExists and leaves no window.
        if let Some(window) = handle.get_webview_window("main") {
            if let Err(error) = window.navigate(url) {
                log_shell_event(&handle, &format!("recovery-navigate-failed {error}"));
            }
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        } else {
            build_main_window(&handle, WebviewUrl::CustomProtocol(url), None);
        }
    });
}

fn spawn_server(app: &AppHandle, data_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let logs_dir = data_dir.join("logs");

    let resource_app = app
        .path()
        .resolve("resources/app", BaseDirectory::Resource)?;
    let server_entry = resource_app.join("server").join("index.js");
    let public_dir = resource_app.join("public");
    let db_file = data_dir.join("prax.db");

    let mut envs: HashMap<String, String> = HashMap::new();
    envs.insert("HOST".into(), "127.0.0.1".into());
    // Node owns the bind and announces its port over this exact child's stdout.
    // It persists the first OS-selected port so webview storage survives
    // relaunch. A later bind collision fails closed; no foreign server opens.
    envs.insert("PORT".into(), "0".into());
    envs.insert(
        "PRAX_DESKTOP_PORT_FILE".into(),
        data_dir.join("webview-port").to_string_lossy().into_owned(),
    );
    envs.insert(
        "PRAX_DB_FILE".into(),
        db_file.to_string_lossy().into_owned(),
    );
    envs.insert(
        "PUBLIC_DIR".into(),
        public_dir.to_string_lossy().into_owned(),
    );
    envs.insert("EMBEDDING_BACKEND".into(), "none".into());
    envs.insert("PRAX_DESKTOP_CONTROL".into(), "stdio".into());

    let (mut rx, child) = app
        .shell()
        .sidecar("prax-server")?
        .args([server_entry.to_string_lossy().as_ref()])
        .envs(envs)
        .spawn()?;

    *app.state::<ServerProcess>().child.lock().unwrap() = Some(child);

    // Pump sidecar output into a bounded log under the data dir and derive
    // lifecycle state only from events produced by this exact child.
    let log_path: PathBuf = logs_dir.join("server.log");
    let _ = rotate_log(&log_path, MAX_SERVER_LOG_BYTES);
    let handle = app.clone();
    let data_dir = data_dir.to_path_buf();
    tauri::async_runtime::spawn(async move {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .ok();
        if file.is_some() {
            let _ = set_owner_only(&log_path, 0o600);
        }
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    match parse_ready_line(&line) {
                        Ok(Some(port)) => {
                            tighten_database_files(&data_dir);
                            handle
                                .state::<ServerProcess>()
                                .set_phase(ServerPhase::Ready(port));
                        }
                        Err(detail) => handle
                            .state::<ServerProcess>()
                            .set_phase(ServerPhase::Failed(detail)),
                        Ok(None) => {}
                    }
                    if let Some(file) = file.as_mut() {
                        let _ = file.write_all(&line);
                        let _ = file.write_all(b"\n");
                    }
                }
                CommandEvent::Terminated(status) => {
                    let code = status
                        .code
                        .map_or_else(|| "none".to_string(), |value| value.to_string());
                    let signal = status
                        .signal
                        .map_or_else(|| "none".to_string(), |value| value.to_string());
                    let detail = format!("The local server exited (code {code}, signal {signal}).");
                    if let Some(file) = file.as_mut() {
                        let _ = writeln!(file, "[prax] server-exit code={code} signal={signal}");
                    }
                    let process = handle.state::<ServerProcess>();
                    *process.child.lock().unwrap() = None;
                    process.set_phase(ServerPhase::Terminated(detail.clone()));
                    if !process.expected_stop.load(Ordering::SeqCst) {
                        let log = log_path.to_string_lossy();
                        show_recovery(
                            &handle,
                            "Prax's local server stopped",
                            format!("{detail} Restart Prax to recover. Diagnostic log: {log}"),
                        );
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn force_kill_server(app: &AppHandle) {
    if let Some(child) = app.state::<ServerProcess>().child.lock().unwrap().take() {
        let _ = child.kill();
    }
}

fn begin_server_shutdown(app: AppHandle, after: AfterShutdown) {
    let process = app.state::<ServerProcess>();
    if process.shutdown_started.swap(true, Ordering::SeqCst) {
        return;
    }
    process.expected_stop.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        let wrote_control = app
            .state::<ServerProcess>()
            .child
            .lock()
            .unwrap()
            .as_mut()
            .is_some_and(|child| child.write(b"shutdown\n").is_ok());

        if !wrote_control
            || !app
                .state::<ServerProcess>()
                .wait_for_termination(SHUTDOWN_TIMEOUT)
        {
            force_kill_server(&app);
        }

        match after {
            AfterShutdown::Exit(code) => app.exit(code),
            AfterShutdown::Restart => app.restart(),
        }
    });
}

// RunEvent::Exit is the one point every quit passes through. macOS
// terminate: (the Dock's Quit, logout, system shutdown) reaches it without
// ExitRequested, so the child may still hold the database open. Ask it to
// close and wait, bounded, on the main thread: the process ends when this
// returns. The child's exit is observed on the sidecar pump task, never the
// main thread, and the child mutex is only held for a pipe write or a kill.
fn finish_server_before_exit(app: &AppHandle) {
    let process = app.state::<ServerProcess>();
    process.expected_stop.store(true, Ordering::SeqCst);
    // A shutdown already begun (tray Quit, ExitRequested) wrote its own
    // request; this barrier then only waits for the same bounded outcome.
    let request_here = !process.shutdown_started.swap(true, Ordering::SeqCst);
    let running = match process.child.lock().unwrap().as_mut() {
        Some(child) => {
            if request_here {
                let _ = child.write(b"shutdown\n");
            }
            true
        }
        None => false,
    };
    if running && !process.wait_for_termination(SHUTDOWN_TIMEOUT) {
        force_kill_server(app);
    }
}

fn on_app_menu_event(app: &AppHandle, id: &str) {
    if id == APP_MENU_QUIT {
        begin_server_shutdown(app.clone(), AfterShutdown::Exit(0));
    }
}

// Tauri's default macOS menu with one change. Its predefined Quit sends NSApp
// terminate:, which skips ExitRequested; this Quit (same ⌘Q) runs the tray's
// graceful shutdown instead. The Edit items must stay: the webview's text
// fields get undo, cut, copy, paste and select-all only through them.
#[cfg(target_os = "macos")]
fn app_menu(handle: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let package = handle.package_info();
    let config = handle.config();
    let about = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };
    let quit = MenuItem::with_id(
        handle,
        APP_MENU_QUIT,
        format!("Quit {}", package.name),
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let window_menu = Submenu::with_id_and_items(
        handle,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;
    let help_menu = Submenu::with_id_and_items(handle, HELP_SUBMENU_ID, "Help", true, &[])?;
    Menu::with_items(
        handle,
        &[
            &Submenu::with_items(
                handle,
                &package.name,
                true,
                &[
                    &PredefinedMenuItem::about(handle, None, Some(about))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::services(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::hide(handle, None)?,
                    &PredefinedMenuItem::hide_others(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &quit,
                ],
            )?,
            &Submenu::with_items(
                handle,
                "File",
                true,
                &[&PredefinedMenuItem::close_window(handle, None)?],
            )?,
            &Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(handle, None)?,
                    &PredefinedMenuItem::redo(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, None)?,
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                ],
            )?,
            &Submenu::with_items(
                handle,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(handle, None)?],
            )?,
            &window_menu,
            &help_menu,
        ],
    )
}

// Build the one "main" window, either on the sidecar origin or on the
// bundled recovery page. Callers run on the main thread.
fn build_main_window(
    handle: &AppHandle,
    url: WebviewUrl,
    sidecar_port: Option<u16>,
) -> Option<WebviewWindow> {
    let builder = WebviewWindowBuilder::new(handle, "main", url)
        .title("Prax")
        .inner_size(1280.0, 800.0)
        .min_inner_size(700.0, 520.0)
        .center()
        // The board's lanes are HTML5 drag and drop. With Tauri's own
        // drag-and-drop handler on, the webview claims every drop as a
        // file drop before the page's `drop` event fires, so a dragged
        // card sprang back to its lane. Nothing in Prax takes file drops,
        // so the handler is off and the page owns drag and drop.
        .disable_drag_drop_handler()
        .on_navigation(move |url| navigation_allowed(url, sidecar_port));
    // macOS: merge the native titlebar into the app's top bar — traffic
    // lights overlay the webview and the toolbar strip becomes draggable
    // (data-tauri-drag-region in the frontend).
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let window = match builder.build() {
        Ok(window) => window,
        Err(error) => {
            log_shell_event(handle, &format!("main-window-build-failed {error}"));
            return None;
        }
    };
    // The live app window closes to the tray (capture and quick reopen stay
    // alive). Once the recovery screen is up — a failed start, or this same
    // window after a sidecar crash — close quits instead, so a dead server
    // cannot leave a hidden zombie process. Exit takes the graceful path if
    // a hung child is still running.
    let app = handle.clone();
    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if app
                .state::<ServerProcess>()
                .recovery_shown
                .load(Ordering::SeqCst)
            {
                app.exit(0);
            } else {
                api.prevent_close();
                let _ = hidden.hide();
            }
        }
    });
    Some(window)
}

// Open the app on the sidecar origin, or surface it if it is already open.
fn open_app_window(handle: &AppHandle, port: u16) {
    let url: tauri::Url = format!(
        "http://127.0.0.1:{port}/?shell=desktop&platform={}",
        platform_name()
    )
    .parse()
    .expect("port url always parses");
    let handle = handle.clone();
    let _ = handle.clone().run_on_main_thread(move || {
        // A crash between readiness and this turn has already put the
        // recovery screen up; the dead origin must not replace it.
        if handle
            .state::<ServerProcess>()
            .recovery_shown
            .load(Ordering::SeqCst)
        {
            return;
        }
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
            return;
        }
        build_main_window(&handle, WebviewUrl::External(url), Some(port));
    });
}

#[tauri::command]
fn restart_prax(app: AppHandle) {
    begin_server_shutdown(app, AfterShutdown::Restart);
}

// Esc / post-capture dismissal from the capture bar page. Hide, never destroy:
// the next summon is instant and the draft field state survives.
#[tauri::command]
fn hide_capture_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }
}

fn current_sidecar_port(app: &AppHandle) -> Option<u16> {
    match &*app.state::<ServerProcess>().phase.lock().unwrap() {
        ServerPhase::Ready(port) => Some(*port),
        _ => None,
    }
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

// Tray "Open Prax", macOS dock reopen, and second-launch focus all funnel
// here: show the hidden main window, or rebuild it if it was destroyed.
fn show_main_window(handle: &AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    } else if let Some(port) = current_sidecar_port(handle) {
        open_app_window(handle, port);
    }
}

// Summon the system-wide capture bar: a small always-on-top window served by
// the sidecar (capture.html), created once and then shown/hidden. Before the
// server is ready there is nothing to capture into — fall back to the main
// window so the user sees the real startup state instead of nothing.
fn open_capture_window(handle: &AppHandle) {
    let Some(port) = current_sidecar_port(handle) else {
        show_main_window(handle);
        return;
    };
    let handle = handle.clone();
    let _ = handle.clone().run_on_main_thread(move || {
        if let Some(existing) = handle.get_webview_window("capture") {
            let _ = existing.show();
            let _ = existing.set_focus();
            return;
        }
        let url: tauri::Url = format!("http://127.0.0.1:{port}/capture.html?shell=desktop")
            .parse()
            .expect("capture url always parses");
        let window = WebviewWindowBuilder::new(&handle, "capture", WebviewUrl::External(url))
            .title("Prax capture")
            .inner_size(640.0, 128.0)
            .resizable(false)
            .decorations(false)
            // The page paints only the rounded bar and leaves html/body
            // transparent; without a transparent window the rest of the
            // 640x128 surface showed as an opaque white slab around it.
            .transparent(true)
            // macOS draws the WINDOW shadow for the full rounded 640x128 frame,
            // which on a transparent window shows as a pale rounded slab with an
            // outline behind the bar. The bar paints its own CSS shadow instead.
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .center()
            .on_navigation(move |url| navigation_allowed(url, Some(port)))
            .build();
        if let Ok(window) = window {
            // The bar should summon on whatever Space/desktop is active —
            // best-effort (macOS/Linux honor it; elsewhere it is a no-op).
            let _ = window.set_visible_on_all_workspaces(true);
            // Focus leaving the bar dismisses it (hide, not destroy).
            let dismissed = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = dismissed.hide();
                }
            });
            let _ = window.set_focus();
        }
    });
}

#[cfg(target_os = "macos")]
const TRAY_TEMPLATE_ICON: tauri::image::Image<'static> =
    tauri::include_image!("icons/tray-template.png");

#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let capture = MenuItem::with_id(app, "capture", "Capture task", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Prax", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Prax", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&capture, &open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("prax-tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Prax")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => open_capture_window(app),
            "open" => show_main_window(app),
            "quit" => begin_server_shutdown(app.clone(), AfterShutdown::Exit(0)),
            _ => {}
        });
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    // A template uses alpha as its mask. The filled Dock icon would become a
    // solid tile, so macOS gets the transparent diamond-and-p mark instead.
    #[cfg(target_os = "macos")]
    {
        tray = tray.icon(TRAY_TEMPLATE_ICON.clone()).icon_as_template(true);
    }
    tray.build(app)?;
    Ok(())
}

// Apply a capture chord: unregister whatever was registered before, then
// register the new one (empty = disabled; the tray Capture item remains).
// Registration failure (another app owns the chord) is a degraded state, not
// an error: the tray path still works, the tooltip says what happened, and
// the caller receives the reason to surface in Settings.
#[cfg(desktop)]
fn apply_capture_shortcut(handle: &AppHandle, shortcut: &str) -> Result<(), String> {
    let state = handle.state::<CaptureShortcut>();
    let mut current = state.0.lock().unwrap();
    if let Some(previous) = current.take() {
        let _ = handle.global_shortcut().unregister(previous.as_str());
    }
    let trimmed = shortcut.trim();
    let tooltip = if trimmed.is_empty() {
        *current = None;
        "Prax — capture shortcut off (use the tray)".to_string()
    } else {
        let outcome = handle
            .global_shortcut()
            .on_shortcut(trimmed, |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    open_capture_window(app);
                }
            });
        match outcome {
            Ok(()) => {
                *current = Some(trimmed.to_string());
                "Prax".to_string()
            }
            Err(error) => {
                *current = None;
                let reason = format!("Prax — capture shortcut unavailable: {error}");
                if let Some(tray) = handle.tray_by_id("prax-tray") {
                    let _ = tray.set_tooltip(Some(reason.clone()));
                }
                return Err(format!("{error}"));
            }
        }
    };
    if let Some(tray) = handle.tray_by_id("prax-tray") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
    Ok(())
}

// Settings UI → live re-registration. Persistence already happened over HTTP
// (app_settings); this command only makes it take effect now and reports the
// honest verdict — the shell is the only party that knows if a chord is free.
#[tauri::command]
fn set_capture_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    #[cfg(desktop)]
    return apply_capture_shortcut(&app, &shortcut);
    #[cfg(not(desktop))]
    {
        let _ = (app, shortcut);
        Err("global shortcuts need the desktop shell".into())
    }
}

// Minimal parse of GET /api/settings/capture-shortcut: the value of the
// "shortcut" JSON string field, from a small same-machine trusted response.
fn parse_shortcut_response(response: &str) -> Option<String> {
    let body = response.split("\r\n\r\n").nth(1)?;
    let key = "\"shortcut\":";
    let start = body.find(key)? + key.len();
    let rest = body[start..].trim_start();
    let mut chars = rest.chars();
    if chars.next() != Some('"') {
        return None;
    }
    let mut value = String::new();
    for ch in chars {
        if ch == '"' {
            return Some(value);
        }
        if ch == '\\' {
            continue; // stored chords never contain escapes; tolerate anyway
        }
        value.push(ch);
    }
    None
}

fn fetch_capture_shortcut(port: u16) -> Option<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(750)));
    let request = format!(
        "GET /api/settings/capture-shortcut HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    parse_shortcut_response(&response)
}

fn smoke_data_dir_from_args<I>(args: I) -> Result<Option<PathBuf>, String>
where
    I: IntoIterator<Item = String>,
{
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--desktop-smoke" {
            let value = args
                .next()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "--desktop-smoke requires an isolated data directory".to_string())?;
            return Ok(Some(PathBuf::from(value)));
        }
    }
    Ok(None)
}

// How a smoke launch ends (scripts/verify-desktop-runtime.mjs). Each drives
// a real quit or crash path and leaves its evidence in server.log/stdout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SmokeExit {
    // The app menu's Quit handler: the graceful shutdown ⌘Q and tray Quit use.
    MenuQuit,
    // NSApp terminate: (Dock Quit, logout): the RunEvent::Exit barrier alone.
    Terminate,
    // SIGKILL the sidecar after the main window opened; expect recovery.
    Crash,
}

fn smoke_exit_from_args<I>(args: I) -> Result<SmokeExit, String>
where
    I: IntoIterator<Item = String>,
{
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--desktop-smoke-exit" {
            return match args.next().as_deref() {
                Some("menu-quit") => Ok(SmokeExit::MenuQuit),
                Some("terminate") if cfg!(target_os = "macos") => Ok(SmokeExit::Terminate),
                Some("crash") => Ok(SmokeExit::Crash),
                _ => Err(
                    "--desktop-smoke-exit takes menu-quit, crash or (macOS only) terminate"
                        .to_string(),
                ),
            };
        }
    }
    Ok(SmokeExit::MenuQuit)
}

// Stop the sidecar the way a crash or `kill -9` does, leaving its lifecycle
// state untouched so the Terminated event decides what the user sees.
fn kill_sidecar_like_a_crash(pid: u32) -> bool {
    let pid = pid.to_string();
    let mut command = if cfg!(windows) {
        let mut command = std::process::Command::new("taskkill");
        command.args(["/F", "/PID", &pid]);
        command
    } else {
        let mut command = std::process::Command::new("kill");
        command.args(["-KILL", &pid]);
        command
    };
    command.status().is_ok_and(|status| status.success())
}

fn run_smoke_exit(app: AppHandle, exit: SmokeExit) {
    match exit {
        SmokeExit::MenuQuit => on_app_menu_event(&app, APP_MENU_QUIT),
        SmokeExit::Terminate => {
            // Deliver terminate: the way the Dock and logout do: from AppKit's
            // run loop, outside tao's event callback. Called directly inside
            // run_on_main_thread it re-enters tao's handler lock through the
            // will-terminate notification and deadlocks (sampled on macOS),
            // which no real quit does.
            #[cfg(target_os = "macos")]
            let _ = app.run_on_main_thread(|| {
                use objc2::sel;
                use objc2_app_kit::NSApplication;
                use objc2_foundation::{MainThreadMarker, NSObjectNSDelayedPerforming};
                let main_thread =
                    MainThreadMarker::new().expect("run_on_main_thread runs on the main thread");
                let ns_app = NSApplication::sharedApplication(main_thread);
                // SAFETY: terminate: is NSApplication's own selector and takes
                // an optional sender, for which nil is valid.
                unsafe {
                    ns_app.performSelector_withObject_afterDelay(sel!(terminate:), None, 0.0)
                };
            });
            #[cfg(not(target_os = "macos"))]
            unreachable!("terminate smoke is refused on this platform");
        }
        SmokeExit::Crash => {
            let pid = app
                .state::<ServerProcess>()
                .child
                .lock()
                .unwrap()
                .as_ref()
                .map(CommandChild::pid);
            let killed = pid.is_some_and(kill_sidecar_like_a_crash);
            let deadline = Instant::now() + Duration::from_secs(15);
            let mut shown = false;
            while killed && !shown && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(200));
                shown = app.get_webview_window("main").is_some_and(|window| {
                    window.is_visible().unwrap_or(false)
                        && window.url().is_ok_and(|url| is_recovery_url(&url))
                });
            }
            if shown {
                println!("PRAX_DESKTOP_SMOKE recovery-shown");
                on_app_menu_event(&app, APP_MENU_QUIT);
            } else {
                eprintln!("PRAX_DESKTOP_SMOKE recovery-missing");
                app.exit(1);
            }
        }
    }
}

// Holding a letter key on macOS opens the accent picker instead of
// repeating the character — wrong for a Markdown editor. Opting this app's
// defaults domain out restores key repeat inside Prax without touching the
// system-wide setting (the picker still works in every other app).
#[cfg(target_os = "macos")]
fn disable_press_and_hold() {
    use objc2_foundation::{ns_string, NSUserDefaults};
    let defaults = NSUserDefaults::standardUserDefaults();
    defaults.setBool_forKey(false, ns_string!("ApplePressAndHoldEnabled"));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    disable_press_and_hold();

    let smoke_data_dir = smoke_data_dir_from_args(std::env::args())
        .expect("invalid Prax desktop smoke-test arguments");
    let smoke_exit =
        smoke_exit_from_args(std::env::args()).expect("invalid Prax desktop smoke-test arguments");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init());
    // A normal launch must not open a second process over the same database,
    // so it registers the single-instance plugin. That plugin keys its socket
    // on the app identifier alone, not on the app-data directory. A smoke
    // launch (`--desktop-smoke <dir>`) owns an isolated directory and never
    // shares a database, so it skips the plugin: with it registered, the smoke
    // on a machine where an installed Prax is running would only surface that
    // app's window and exit without ever starting its own sidecar.
    let builder = if smoke_data_dir.is_none() {
        builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch: surface the existing instance (the main window
            // may be hidden in the tray) instead of opening a second app over
            // the same database.
            show_main_window(app);
        }))
    } else {
        builder
    };
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(app_menu)
        .on_menu_event(|app, event| on_app_menu_event(app, event.id().as_ref()));

    builder
        .invoke_handler(tauri::generate_handler![
            save_library_export,
            restart_prax,
            hide_capture_window,
            set_capture_shortcut
        ])
        .manage(ServerProcess::new())
        .manage(CaptureShortcut(Mutex::new(None)))
        .setup(move |app| {
            let handle = app.handle().clone();
            let data_dir = prepare_data_dir(&handle, smoke_data_dir.clone())?;
            app.manage(ShellLog(data_dir.join("logs").join("server.log")));

            // The tray exists before (and regardless of) server startup, so
            // Quit and Open Prax always work — even during a failed launch.
            #[cfg(desktop)]
            setup_tray(app)?;

            // The server starts before any webview work — its liveness must
            // not depend on the platform webview initializing.
            if let Err(error) = spawn_server(&handle, &data_dir) {
                let reason = format!("The bundled local server could not be launched: {error}");
                handle
                    .state::<ServerProcess>()
                    .set_phase(ServerPhase::Failed(reason.clone()));
                show_recovery(
                    &handle,
                    "Prax could not start",
                    format!(
                        "{reason} Restart Prax to try again. Diagnostic folder: {}",
                        data_dir.join("logs").to_string_lossy()
                    ),
                );
                return Ok(());
            }

            std::thread::spawn(move || {
                let ready = handle
                    .state::<ServerProcess>()
                    .wait_for_ready(STARTUP_TIMEOUT)
                    .and_then(|port| {
                        if wait_until_http_ready(port, Duration::from_secs(5)) {
                            Ok(port)
                        } else {
                            Err(format!(
                                "The local server announced port {port}, but /readyz did not become healthy."
                            ))
                        }
                    });

                if let Ok(port) = ready {
                    open_app_window(&handle, port);

                    // The summon chord only means something once there is a
                    // server to capture into; the stored chord wins, the
                    // default covers absence and fetch failure.
                    #[cfg(desktop)]
                    {
                        let chord = fetch_capture_shortcut(port)
                            .unwrap_or_else(|| CAPTURE_SHORTCUT_DEFAULT.to_string());
                        let _ = apply_capture_shortcut(&handle, &chord);
                    }

                    if smoke_data_dir.is_some() {
                        std::thread::sleep(Duration::from_secs(1));
                        run_smoke_exit(handle, smoke_exit);
                    }
                } else {
                    let reason = ready.err().unwrap_or_else(|| "Unknown startup failure.".into());
                    let logs = data_dir.join("logs").join("server.log");
                    show_recovery(
                        &handle,
                        "Prax could not start",
                        format!(
                            "{reason} Restart Prax to try again. Diagnostic log: {}",
                            logs.to_string_lossy()
                        ),
                    );
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Prax application")
        .run(|app, event| match event {
            RunEvent::ExitRequested { code, api, .. } => {
                if app.state::<ServerProcess>().child.lock().unwrap().is_some() {
                    api.prevent_exit();
                    begin_server_shutdown(app.clone(), AfterShutdown::Exit(code.unwrap_or(0)));
                }
            }
            RunEvent::Exit => finish_server_before_exit(app),
            // macOS dock icon click while every window is hidden in the tray.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main_window(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::io::Write;

    use super::{
        is_recovery_url, navigation_allowed, normalize_export_filename, parse_ready_line,
        parse_shortcut_response, recovery_url, rotate_log, smoke_data_dir_from_args,
        smoke_exit_from_args, SmokeExit,
    };

    #[cfg(target_os = "macos")]
    #[test]
    fn tray_template_has_transparent_negative_space_and_monochrome_ink() {
        let icon = &super::TRAY_TEMPLATE_ICON;
        let pixels: Vec<_> = icon.rgba().chunks_exact(4).collect();
        let ink: Vec<_> = pixels.iter().filter(|pixel| pixel[3] > 0).collect();
        // A filled app-icon tile becomes a solid square when macOS tints its
        // alpha mask. Require a sparse mark, not an opaque background or blank.
        assert!(
            ink.len() * 100 / pixels.len() < 55,
            "menu-bar template must leave most of its pixels transparent"
        );
        assert!(
            ink.len() * 100 / pixels.len() > 15,
            "menu-bar template must contain a visible mark"
        );
        assert!(ink.iter().all(|pixel| pixel[..3] == [0, 0, 0]));
        assert_eq!((icon.width(), icon.height()), (44, 44));
    }

    #[test]
    fn shortcut_response_parsing_is_strict_about_shape_but_tolerant_of_headers() {
        let ok = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"shortcut\":\"Alt+Space\",\"default\":\"CmdOrCtrl+Shift+Space\"}";
        assert_eq!(parse_shortcut_response(ok), Some("Alt+Space".to_string()));
        let disabled = "HTTP/1.0 200 OK\r\n\r\n{\"shortcut\":\"\"}";
        assert_eq!(parse_shortcut_response(disabled), Some(String::new()));
        assert_eq!(parse_shortcut_response("HTTP/1.0 200 OK\r\n\r\n{}"), None);
        assert_eq!(parse_shortcut_response("garbage"), None);
    }

    #[test]
    fn export_filename_is_a_safe_zip_basename() {
        assert_eq!(
            normalize_export_filename("prax-library-work-2026-07-13.zip"),
            "prax-library-work-2026-07-13.zip"
        );
        assert_eq!(
            normalize_export_filename("../../Library Backup"),
            "Library Backup.zip"
        );
        assert_eq!(
            normalize_export_filename("..\\bad:name?.ZIP"),
            "bad-name-.ZIP"
        );
        assert_eq!(normalize_export_filename("..."), "prax-library.zip");
    }

    #[test]
    fn readiness_requires_the_structured_child_message() {
        assert_eq!(
            parse_ready_line(b"PRAX_DESKTOP_READY {\"port\":43127}\n").unwrap(),
            Some(43127)
        );
        assert_eq!(parse_ready_line(b"ordinary server log").unwrap(), None);
        assert!(parse_ready_line(b"PRAX_DESKTOP_READY {\"port\":0}").is_err());
        assert!(parse_ready_line(b"PRAX_DESKTOP_READY nope").is_err());
    }

    #[test]
    fn navigation_is_limited_to_the_exact_sidecar_or_bundled_origin() {
        let exact: tauri::Url = "http://127.0.0.1:43127/library".parse().unwrap();
        let wrong_port: tauri::Url = "http://127.0.0.1:43128/".parse().unwrap();
        let localhost_alias: tauri::Url = "http://localhost:43127/".parse().unwrap();
        let remote: tauri::Url = "https://example.com/".parse().unwrap();
        let bundled: tauri::Url = "tauri://localhost/".parse().unwrap();
        let windows_bundled: tauri::Url = "http://tauri.localhost/".parse().unwrap();

        assert!(navigation_allowed(&exact, Some(43127)));
        assert!(!navigation_allowed(&wrong_port, Some(43127)));
        assert!(!navigation_allowed(&localhost_alias, Some(43127)));
        assert!(!navigation_allowed(&remote, Some(43127)));
        assert!(navigation_allowed(&bundled, Some(43127)));
        assert!(navigation_allowed(&windows_bundled, None));
    }

    #[test]
    fn recovery_screen_carries_its_reason_as_inert_query_text() {
        let heading = "Prax's local server stopped";
        let detail = "The local server exited (code none, signal 9). Restart Prax to recover. \
                      Diagnostic log: /Users/a b/Library/Application Support/com.moomora.prax/logs/server.log \
                      & \"quotes\" </script><script>alert(1)</script> ?#=%\n";
        let url = recovery_url(heading, detail);

        assert!(is_recovery_url(&url));
        assert_eq!(url.path(), "/index.html");
        assert_eq!(
            url.fragment(),
            None,
            "a # in the detail must stay inside the query"
        );
        let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
        assert_eq!(
            pairs,
            vec![
                ("state".to_string(), "error".to_string()),
                ("heading".to_string(), heading.to_string()),
                ("detail".to_string(), detail.to_string()),
            ]
        );
        assert!(!url.as_str().contains('<') && !url.as_str().contains('"'));
    }

    #[test]
    fn an_open_sidecar_window_may_navigate_to_the_recovery_screen() {
        let url = recovery_url("Prax could not start", "detail");
        // The live window's navigation policy is pinned to its sidecar port;
        // the bundled recovery origin must stay reachable from it.
        assert!(navigation_allowed(&url, Some(43127)));
        assert!(navigation_allowed(&url, None));

        let live: tauri::Url = "http://127.0.0.1:43127/?shell=desktop&state=error"
            .parse()
            .unwrap();
        let splash: tauri::Url = "tauri://localhost/index.html".parse().unwrap();
        assert!(!is_recovery_url(&live));
        assert!(!is_recovery_url(&splash));
    }

    #[test]
    fn smoke_exit_defaults_to_the_menu_quit_and_rejects_unknown_modes() {
        assert_eq!(
            smoke_exit_from_args(["prax".into(), "--desktop-smoke".into(), "/tmp/x".into()]),
            Ok(SmokeExit::MenuQuit)
        );
        assert_eq!(
            smoke_exit_from_args(["prax".into(), "--desktop-smoke-exit".into(), "crash".into()]),
            Ok(SmokeExit::Crash)
        );
        assert_eq!(
            smoke_exit_from_args([
                "prax".into(),
                "--desktop-smoke-exit".into(),
                "terminate".into()
            ])
            .is_ok(),
            cfg!(target_os = "macos")
        );
        assert!(smoke_exit_from_args(["prax".into(), "--desktop-smoke-exit".into()]).is_err());
        assert!(smoke_exit_from_args([
            "prax".into(),
            "--desktop-smoke-exit".into(),
            "sigterm".into()
        ])
        .is_err());
    }

    #[test]
    fn oversized_log_rotates_to_one_bounded_predecessor() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("server.log");
        let mut file = File::create(&path).unwrap();
        file.write_all(b"123456").unwrap();
        drop(file);

        assert!(rotate_log(&path, 5).unwrap());
        assert!(!path.exists());
        assert_eq!(
            fs::read(dir.path().join("server.log.1")).unwrap(),
            b"123456"
        );
        assert!(!rotate_log(&path, 5).unwrap());
    }

    #[test]
    fn smoke_directory_is_explicit_and_required() {
        assert_eq!(
            smoke_data_dir_from_args([
                "prax".into(),
                "--desktop-smoke".into(),
                "/tmp/prax-smoke".into()
            ])
            .unwrap(),
            Some("/tmp/prax-smoke".into())
        );
        assert_eq!(smoke_data_dir_from_args(["prax".into()]).unwrap(), None);
        assert!(smoke_data_dir_from_args(["prax".into(), "--desktop-smoke".into()]).is_err());
    }
}
