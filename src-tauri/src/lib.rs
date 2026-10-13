// Prax desktop shell (see docs/desktop/BUILD.md).
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
// A failed start's one structured line (server/desktopLifecycle.js).
const FAILED_PREFIX: &str = "PRAX_DESKTOP_FAILED ";
// Upgrade migrations reported before the server listens.
const PROGRESS_PREFIX: &str = "PRAX_DESKTOP_PROGRESS ";
// System-wide capture summon. Contended defaults are useless — this chord is
// rarely claimed; registration failure surfaces in the tray tooltip. The
// USER's chord lives in app_settings (fetched after the server is ready);
// this is only the fallback when nothing is stored or the fetch fails.
const CAPTURE_SHORTCUT_DEFAULT: &str = "CmdOrCtrl+Shift+Space";

// The currently registered capture chord, so a settings change can
// unregister it before registering the replacement.
struct CaptureShortcut(Mutex<Option<String>>);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
// While the child reports upgrade migrations, each report renews this budget
// instead of the 30-second one: a long upgrade is progress, not a hung start.
const MIGRATION_TIMEOUT: Duration = Duration::from_secs(10 * 60);
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
    // Running an upgrade migration; set again for each one it reports.
    Migrating,
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

    // Wait for readiness within `startup`. Each migration the child reports
    // renews a `migration` budget instead; once migrations finish the startup
    // budget starts again, so a hang after the upgrade is still caught.
    fn wait_for_ready(&self, startup: Duration, migration: Duration) -> Result<u16, String> {
        let mut deadline = Instant::now() + startup;
        let mut migrating = false;
        // False only after a timed-out wait: then nothing was reported and
        // the current deadline stands.
        let mut notified = true;
        let mut phase = self.phase.lock().unwrap();
        loop {
            match &*phase {
                ServerPhase::Ready(port) => return Ok(*port),
                ServerPhase::Failed(detail) | ServerPhase::Terminated(detail) => {
                    return Err(detail.clone())
                }
                ServerPhase::Migrating if notified => {
                    migrating = true;
                    deadline = Instant::now() + migration;
                }
                ServerPhase::Starting if notified && migrating => {
                    migrating = false;
                    deadline = Instant::now() + startup;
                }
                ServerPhase::Starting | ServerPhase::Migrating => {}
            }

            let now = Instant::now();
            if now >= deadline {
                return Err(if migrating {
                    format!(
                        "Prax's database upgrade reported no progress for {} minutes. Finished upgrade steps are kept; restart Prax to continue.",
                        migration.as_secs() / 60
                    )
                } else {
                    format!(
                        "The local server did not announce readiness within {} seconds. Restart Prax to try again.",
                        startup.as_secs()
                    )
                });
            }
            let (next, result) = self
                .phase_changed
                .wait_timeout(phase, deadline.saturating_duration_since(now))
                .unwrap();
            phase = next;
            notified = !result.timed_out();
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

// The suggested name travels in this header, percent-encoded by the page
// (encodeURIComponent), because the invoke body is the archive itself.
const EXPORT_FILENAME_HEADER: &str = "prax-export-filename";

fn decode_export_filename(value: &str) -> String {
    let mut url: tauri::Url = BUNDLED_ORIGIN
        .parse()
        .expect("bundled origin always parses");
    url.set_query(Some(&format!("name={value}")));
    url.query_pairs()
        .find(|(key, _)| key == "name")
        .map(|(_, name)| name.into_owned())
        .unwrap_or_default()
}

// The archive arrives as a raw invoke body: the bytes as they are, not a JSON
// array of numbers (a 50 MB archive became a 179 MB body and ~700 MB of page
// heap that way). A webview that falls back to postMessage IPC can only send
// JSON, so that shape is still accepted there.
fn export_archive_bytes(body: &tauri::ipc::InvokeBody) -> Result<Vec<u8>, String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(value) => value
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .map(|item| item.as_u64().and_then(|byte| u8::try_from(byte).ok()))
                    .collect::<Option<Vec<u8>>>()
            })
            .ok_or_else(|| "The Library archive did not arrive as bytes.".to_string()),
    }
}

// The webview never supplies a filesystem path. This command always obtains
// the destination through the native Save dialog, then atomically replaces it
// from a same-directory temporary file once every archive byte is durable.
#[tauri::command]
async fn save_library_export(
    window: tauri::Window,
    request: tauri::ipc::Request<'_>,
) -> Result<Option<String>, String> {
    let file_name = request
        .headers()
        .get(EXPORT_FILENAME_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(decode_export_filename)
        .unwrap_or_default();
    let bytes = export_archive_bytes(request.body())?;
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

// One field of the flat, single-line JSON object on a structured child line:
// a string without escapes, or an unsigned integer.
fn json_field<'a>(payload: &'a str, key: &str) -> Option<&'a str> {
    let marker = format!("\"{key}\":");
    let rest = payload[payload.find(&marker)? + marker.len()..].trim_start();
    if let Some(quoted) = rest.strip_prefix('"') {
        return quoted.find('"').map(|end| &quoted[..end]);
    }
    let end = rest
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(rest.len());
    (end > 0).then(|| &rest[..end])
}

// What the person reads on the recovery screen for a start the child itself
// reported as failed. Each message ends with what to do next.
fn startup_failure_message(reason: &str, port: Option<u16>) -> String {
    match (reason, port) {
        ("port-in-use", Some(port)) => format!(
            "Another program is using port {port}. Prax keeps that local address so this installation's drafts and preferences stay available, and will not start on a different one. Quit the program using port {port} (restarting the computer also frees it), then restart Prax."
        ),
        ("port-in-use", None) => {
            "Another program took the local port Prax was given. Restart Prax to try again.".into()
        }
        ("migration-failed", _) => "Prax could not upgrade its database; the failed step was rolled back and your data is unchanged by it. Restart Prax to try again, and keep the diagnostic log if it fails again.".into(),
        (other, _) => format!("The local server could not start ({other}). Restart Prax to try again."),
    }
}

#[derive(Debug, PartialEq, Eq)]
enum ChildReport {
    Failed(String),
    Migrating,
    Migrated,
}

fn parse_child_report(line: &[u8]) -> Option<ChildReport> {
    let value = String::from_utf8_lossy(line);
    let trimmed = value.trim();
    if let Some(payload) = trimmed.strip_prefix(FAILED_PREFIX) {
        let reason = json_field(payload, "reason").unwrap_or("startup-error");
        let port = json_field(payload, "port")
            .and_then(|port| port.parse::<u16>().ok())
            .filter(|port| *port > 0);
        return Some(ChildReport::Failed(startup_failure_message(reason, port)));
    }
    let payload = trimmed.strip_prefix(PROGRESS_PREFIX)?;
    match json_field(payload, "phase")? {
        "migrating" => Some(ChildReport::Migrating),
        "migrated" => Some(ChildReport::Migrated),
        _ => None,
    }
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
    rotate_now(path)?;
    Ok(true)
}

fn rotate_now(path: &Path) -> std::io::Result<()> {
    let rotated = path.with_extension("log.1");
    if rotated.exists() {
        std::fs::remove_file(&rotated)?;
    }
    std::fs::rename(path, rotated)
}

// The sidecar's log, bounded within a session and not only at spawn: a line
// that would take the file past its cap first rotates it to server.log.1.
// The size comes from the open file, so the shell's own lines (appended by
// path in log_shell_event, which then follows the rotation) count too.
struct BoundedLog {
    path: PathBuf,
    max_bytes: u64,
    file: Option<std::fs::File>,
}

impl BoundedLog {
    fn open(path: PathBuf, max_bytes: u64) -> Self {
        let _ = rotate_log(&path, max_bytes);
        let mut log = Self {
            path,
            max_bytes,
            file: None,
        };
        log.reopen();
        log
    }

    fn reopen(&mut self) {
        self.file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .ok();
        if self.file.is_some() {
            let _ = set_owner_only(&self.path, 0o600);
        }
    }

    fn write_line(&mut self, line: &[u8]) {
        // Child output lines arrive with their newline; write exactly one.
        let line = line.strip_suffix(b"\n").unwrap_or(line);
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        let size = self
            .file
            .as_ref()
            .and_then(|file| file.metadata().ok())
            .map_or(0, |metadata| metadata.len());
        if size > 0 && size + line.len() as u64 + 1 > self.max_bytes {
            // Close before renaming; Windows cannot rename an open file.
            self.file = None;
            let _ = rotate_now(&self.path);
            self.reopen();
        }
        if let Some(file) = self.file.as_mut() {
            let _ = file.write_all(line);
            let _ = file.write_all(b"\n");
        }
    }
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
    let handle = app.clone();
    let data_dir = data_dir.to_path_buf();
    tauri::async_runtime::spawn(async move {
        let mut log = BoundedLog::open(log_path.clone(), MAX_SERVER_LOG_BYTES);
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let process = handle.state::<ServerProcess>();
                    match parse_ready_line(&line) {
                        Ok(Some(port)) => {
                            tighten_database_files(&data_dir);
                            process.set_phase(ServerPhase::Ready(port));
                        }
                        Err(detail) => process.set_phase(ServerPhase::Failed(format!(
                            "{detail} Restart Prax to try again."
                        ))),
                        Ok(None) => match parse_child_report(&line) {
                            Some(ChildReport::Failed(message)) => {
                                process.set_phase(ServerPhase::Failed(message))
                            }
                            Some(ChildReport::Migrating) => {
                                process.set_phase(ServerPhase::Migrating)
                            }
                            Some(ChildReport::Migrated) => process.set_phase(ServerPhase::Starting),
                            None => {}
                        },
                    }
                    log.write_line(&line);
                }
                CommandEvent::Terminated(status) => {
                    let code = status
                        .code
                        .map_or_else(|| "none".to_string(), |value| value.to_string());
                    let signal = status
                        .signal
                        .map_or_else(|| "none".to_string(), |value| value.to_string());
                    let exited = format!("The local server exited (code {code}, signal {signal}).");
                    log.write_line(
                        format!("[prax] server-exit code={code} signal={signal}").as_bytes(),
                    );
                    let process = handle.state::<ServerProcess>();
                    *process.child.lock().unwrap() = None;
                    // An exit before readiness is a failed start: keep the
                    // reason the child gave, so the startup waiter and this
                    // handler show the same advice whichever reaches it first.
                    let previous = process.phase.lock().unwrap().clone();
                    let startup_failure = match previous {
                        ServerPhase::Ready(_) => None,
                        ServerPhase::Failed(reason) => Some(reason),
                        _ => Some(format!("{exited} Restart Prax to try again.")),
                    };
                    process.set_phase(ServerPhase::Terminated(
                        startup_failure.clone().unwrap_or_else(|| exited.clone()),
                    ));
                    if !process.expected_stop.load(Ordering::SeqCst) {
                        let log = log_path.to_string_lossy();
                        match startup_failure {
                            None => show_recovery(
                                &handle,
                                "Prax's local server stopped",
                                format!("{exited} Restart Prax to recover. Diagnostic log: {log}"),
                            ),
                            Some(reason) => show_recovery(
                                &handle,
                                "Prax could not start",
                                format!("{reason} Diagnostic log: {log}"),
                            ),
                        }
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
    // Open the capture bar first, then crash: recovery must replace the dead
    // bar, and summoning capture again must bring recovery forward.
    CaptureCrash,
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
                Some("capture-crash") => Ok(SmokeExit::CaptureCrash),
                _ => Err(
                    "--desktop-smoke-exit takes menu-quit, crash, capture-crash or (macOS only) terminate"
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
            let shown = crash_sidecar(&app)
                && smoke_wait(Duration::from_secs(15), || main_shows_recovery(&app));
            if smoke_checkpoint(&app, shown, "recovery-shown") {
                on_app_menu_event(&app, APP_MENU_QUIT);
            }
        }
        SmokeExit::CaptureCrash => {
            // The tray item and the global shortcut both summon through here.
            open_capture_window(&app);
            // The bar hides itself when it loses focus, and a smoke launch is
            // not always the frontmost app, so it can vanish as it appears.
            // Summon it again then, as a person pressing the shortcut would.
            let mut polls = 0;
            let opened = smoke_wait(Duration::from_secs(10), || {
                polls += 1;
                if window_visible(&app, "capture") {
                    return true;
                }
                if polls % 5 == 0 {
                    open_capture_window(&app);
                }
                false
            });
            if !opened {
                eprintln!(
                    "PRAX_DESKTOP_SMOKE capture window exists={} visible={} focused={:?}",
                    app.get_webview_window("capture").is_some(),
                    window_visible(&app, "capture"),
                    app.get_webview_window("capture")
                        .map(|window| window.is_focused())
                );
            }
            if !smoke_checkpoint(&app, opened, "capture-opened") {
                return;
            }
            let recovered = crash_sidecar(&app)
                && smoke_wait(Duration::from_secs(15), || {
                    main_shows_recovery(&app) && !window_visible(&app, "capture")
                });
            if !smoke_checkpoint(&app, recovered, "capture-hidden-recovery-shown") {
                return;
            }
            // Hide the recovery window, as a close-to-tray before the crash
            // would have, so the next summon has to bring it forward itself.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
            let hidden = smoke_wait(Duration::from_secs(5), || !window_visible(&app, "main"));
            open_capture_window(&app);
            let forward = hidden
                && smoke_wait(Duration::from_secs(10), || {
                    main_shows_recovery(&app) && !window_visible(&app, "capture")
                });
            if smoke_checkpoint(&app, forward, "capture-summon-shows-recovery") {
                on_app_menu_event(&app, APP_MENU_QUIT);
            }
        }
    }
}

// Smoke polling runs on the smoke thread, never the main thread: each window
// query below is a round trip through the event loop.
fn smoke_wait(limit: Duration, mut check: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + limit;
    loop {
        if check() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn window_visible(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .is_some_and(|window| window.is_visible().unwrap_or(false))
}

fn main_shows_recovery(app: &AppHandle) -> bool {
    app.get_webview_window("main").is_some_and(|window| {
        window.is_visible().unwrap_or(false) && window.url().is_ok_and(|url| is_recovery_url(&url))
    })
}

fn crash_sidecar(app: &AppHandle) -> bool {
    let pid = app
        .state::<ServerProcess>()
        .child
        .lock()
        .unwrap()
        .as_ref()
        .map(CommandChild::pid);
    pid.is_some_and(kill_sidecar_like_a_crash)
}

// Report one smoke checkpoint on stdout; a missed one ends the launch with 1.
fn smoke_checkpoint(app: &AppHandle, passed: bool, name: &str) -> bool {
    if passed {
        println!("PRAX_DESKTOP_SMOKE {name}");
    } else {
        eprintln!("PRAX_DESKTOP_SMOKE {name}-missing");
        app.exit(1);
    }
    passed
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
                    .wait_for_ready(STARTUP_TIMEOUT, MIGRATION_TIMEOUT)
                    .and_then(|port| {
                        if wait_until_http_ready(port, Duration::from_secs(5)) {
                            Ok(port)
                        } else {
                            Err(format!(
                                "The local server announced port {port}, but /readyz did not become healthy. Restart Prax to try again."
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
                    // Every startup reason already ends with its own advice.
                    let reason = ready.err().unwrap_or_else(|| {
                        "Unknown startup failure. Restart Prax to try again.".into()
                    });
                    let logs = data_dir.join("logs").join("server.log");
                    show_recovery(
                        &handle,
                        "Prax could not start",
                        format!("{reason} Diagnostic log: {}", logs.to_string_lossy()),
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

    use std::time::Duration;

    use super::{
        decode_export_filename, export_archive_bytes, is_recovery_url, navigation_allowed,
        normalize_export_filename, parse_child_report, parse_ready_line, parse_shortcut_response,
        recovery_url, rotate_log, smoke_data_dir_from_args, smoke_exit_from_args, BoundedLog,
        ChildReport, ServerPhase, ServerProcess, SmokeExit,
    };

    #[test]
    fn a_port_collision_explains_itself_and_names_the_port() {
        let Some(ChildReport::Failed(message)) = parse_child_report(
            b"PRAX_DESKTOP_FAILED {\"reason\":\"port-in-use\",\"port\":43127}\n",
        ) else {
            panic!("a failed start is a structured report");
        };
        assert!(message.contains("Another program is using port 43127"));
        assert!(message.contains("Quit the program using port 43127"));
        assert!(!message.starts_with("Restart Prax"));

        let Some(ChildReport::Failed(unnamed)) =
            parse_child_report(b"PRAX_DESKTOP_FAILED {\"reason\":\"port-in-use\"}")
        else {
            panic!("a collision without a saved port is still a failure");
        };
        assert!(unnamed.contains("Restart Prax to try again"));
        let Some(ChildReport::Failed(other)) =
            parse_child_report(b"PRAX_DESKTOP_FAILED {\"reason\":\"startup-error\"}")
        else {
            panic!("any other reason is a failure too");
        };
        assert_eq!(
            other,
            "The local server could not start (startup-error). Restart Prax to try again."
        );
        assert!(matches!(
            parse_child_report(b"PRAX_DESKTOP_FAILED {\"reason\":\"migration-failed\"}"),
            Some(ChildReport::Failed(message)) if message.contains("rolled back")
        ));
    }

    #[test]
    fn migration_progress_is_a_structured_report_and_ordinary_lines_are_not() {
        assert_eq!(
            parse_child_report(
                b"PRAX_DESKTOP_PROGRESS {\"phase\":\"migrating\",\"index\":2,\"total\":9}\n"
            ),
            Some(ChildReport::Migrating)
        );
        assert_eq!(
            parse_child_report(b"PRAX_DESKTOP_PROGRESS {\"phase\":\"migrated\",\"total\":9}"),
            Some(ChildReport::Migrated)
        );
        assert_eq!(
            parse_child_report(b"PRAX_DESKTOP_PROGRESS {\"phase\":\"other\"}"),
            None
        );
        assert_eq!(
            parse_child_report(b"{\"level\":30,\"msg\":\"PRAX_DESKTOP_FAILED\"}"),
            None
        );
        assert_eq!(parse_child_report(b"PRAX_DESKTOP_READY {\"port\":1}"), None);
    }

    #[test]
    fn reported_migrations_extend_the_startup_budget_and_a_silent_start_still_times_out() {
        let process = std::sync::Arc::new(ServerProcess::new());
        let reporter = std::sync::Arc::clone(&process);
        let child = std::thread::spawn(move || {
            // Six reports 100 ms apart outlast the 500 ms startup budget. The
            // budgets are generous on purpose: on a loaded CI runner the first
            // report once arrived after a 100 ms budget had already expired
            // (v0.45.0's macOS build), which is scheduling, not the logic
            // under test.
            for _ in 0..6 {
                std::thread::sleep(Duration::from_millis(100));
                reporter.set_phase(ServerPhase::Migrating);
            }
            reporter.set_phase(ServerPhase::Starting);
            std::thread::sleep(Duration::from_millis(20));
            reporter.set_phase(ServerPhase::Ready(43127));
        });
        assert_eq!(
            process.wait_for_ready(Duration::from_millis(500), Duration::from_millis(1_000)),
            Ok(43127)
        );
        child.join().unwrap();

        // A migration that stops reporting runs out of its own budget.
        let stalled = ServerProcess::new();
        stalled.set_phase(ServerPhase::Migrating);
        let error = stalled
            .wait_for_ready(Duration::from_millis(50), Duration::from_millis(120))
            .unwrap_err();
        assert!(error.contains("database upgrade"), "{error}");

        let silent = ServerProcess::new();
        let error = silent
            .wait_for_ready(Duration::from_millis(50), Duration::from_secs(60))
            .unwrap_err();
        assert!(error.contains("did not announce readiness"), "{error}");
    }

    #[test]
    fn the_session_log_rotates_when_a_line_would_pass_its_cap() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("server.log");
        let mut log = BoundedLog::open(path.clone(), 32);
        log.write_line(b"0123456789\n");
        log.write_line(b"0123456789");
        assert!(!dir.path().join("server.log.1").exists());
        log.write_line(b"third line");
        assert_eq!(
            fs::read(dir.path().join("server.log.1")).unwrap(),
            b"0123456789\n0123456789\n"
        );
        assert_eq!(fs::read(&path).unwrap(), b"third line\n");
        for _ in 0..20 {
            log.write_line(b"0123456789");
        }
        assert!(fs::metadata(&path).unwrap().len() <= 32);
        assert!(fs::metadata(dir.path().join("server.log.1")).unwrap().len() <= 32);
    }

    #[test]
    fn the_export_travels_as_raw_bytes_with_its_name_in_a_header() {
        let raw = tauri::ipc::InvokeBody::from(vec![0_u8, 1, 255]);
        assert_eq!(export_archive_bytes(&raw).unwrap(), vec![0, 1, 255]);
        assert_eq!(
            decode_export_filename("prax-library-all-2026-09-23.zip"),
            "prax-library-all-2026-09-23.zip"
        );
        // encodeURIComponent output for a renamed, non-ASCII file.
        assert_eq!(
            decode_export_filename("Biblioth%C3%A8que%20%26%20notes%2B1.zip"),
            "Bibliothèque & notes+1.zip"
        );
        assert_eq!(
            normalize_export_filename(&decode_export_filename("..%2F..%2Fescape")),
            "escape.zip"
        );
    }

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
                "capture-crash".into()
            ]),
            Ok(SmokeExit::CaptureCrash)
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
