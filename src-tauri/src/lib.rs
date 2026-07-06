// Prax desktop shell (docs/desktop/checklist.md Phase 3).
//
// Lifecycle: pick a free localhost port → spawn the bundled Node runtime as a
// sidecar running the Fastify server (database + logs under the OS app-data
// dir) → open the splash window → poll /readyz → navigate the window to the
// served app. The sidecar is started *before* any webview work so the data
// layer's liveness never depends on the platform webview initializing.
// Single-instance locking keeps two windows from opening the same database;
// the sidecar is killed when the app exits (SQLite WAL is crash-safe, and the
// server also closes cleanly on SIGTERM for the non-desktop paths).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct ServerChild(Mutex<Option<CommandChild>>);

fn free_port() -> u16 {
    // Bind :0, read the assigned port, drop the listener. The race window
    // before the sidecar rebinds is negligible on a local machine.
    TcpListener::bind("127.0.0.1:0")
        .expect("no free localhost port")
        .local_addr()
        .expect("listener has no local addr")
        .port()
}

fn http_ready(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(750)));
    let request = format!(
        "GET /readyz HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    response.starts_with("HTTP/1.0 200") || response.starts_with("HTTP/1.1 200")
}

fn wait_until_ready(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if http_ready(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn spawn_server(app: &AppHandle, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    let logs_dir = data_dir.join("logs");
    std::fs::create_dir_all(&logs_dir)?;

    let resource_app = app
        .path()
        .resolve("resources/app", BaseDirectory::Resource)?;
    let server_entry = resource_app.join("server").join("index.js");
    let public_dir = resource_app.join("public");
    let db_file = data_dir.join("prax.db");

    let mut envs: HashMap<String, String> = HashMap::new();
    envs.insert("HOST".into(), "127.0.0.1".into());
    envs.insert("PORT".into(), port.to_string());
    envs.insert("PRAX_DB_FILE".into(), db_file.to_string_lossy().into_owned());
    envs.insert("PUBLIC_DIR".into(), public_dir.to_string_lossy().into_owned());
    envs.insert("EMBEDDING_BACKEND".into(), "none".into());

    let (mut rx, child) = app
        .shell()
        .sidecar("prax-server")?
        .args([server_entry.to_string_lossy().as_ref()])
        .envs(envs)
        .spawn()?;

    *app.state::<ServerChild>().0.lock().unwrap() = Some(child);

    // Pump sidecar output into a log file under the data dir.
    let log_path: PathBuf = logs_dir.join("server.log");
    tauri::async_runtime::spawn(async move {
        use std::fs::OpenOptions;
        let file = OpenOptions::new().create(true).append(true).open(&log_path);
        let Ok(mut file) = file else { return };
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let _ = file.write_all(&line);
                    let _ = file.write_all(b"\n");
                }
                CommandEvent::Terminated(status) => {
                    let _ = writeln!(file, "[prax] server exited: {status:?}");
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn kill_server(app: &AppHandle) {
    if let Some(child) = app.state::<ServerChild>().0.lock().unwrap().take() {
        let _ = child.kill();
    }
}

fn open_window(handle: &AppHandle, url: WebviewUrl, error_detail: Option<String>) {
    let handle = handle.clone();
    let _ = handle.clone().run_on_main_thread(move || {
        let window = WebviewWindowBuilder::new(&handle, "main", url)
            .title("Prax")
            .inner_size(1280.0, 800.0)
            .min_inner_size(700.0, 520.0)
            .center()
            .build();
        if let (Ok(window), Some(detail)) = (window, error_detail) {
            let _ = window.eval(&format!(
                "addEventListener('DOMContentLoaded',()=>{{document.body.dataset.state='error';document.getElementById('detail').textContent={detail:?};}});"
            ));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch: focus the existing window instead of opening a
            // second app over the same database.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .manage(ServerChild(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let port = free_port();

            // The server starts before any webview work — its liveness must
            // not depend on the platform webview initializing.
            spawn_server(&handle, port)?;

            std::thread::spawn(move || {
                if wait_until_ready(port, Duration::from_secs(30)) {
                    let url = format!("http://127.0.0.1:{port}/")
                        .parse()
                        .expect("port url always parses");
                    open_window(&handle, WebviewUrl::External(url), None);
                } else {
                    let logs = handle
                        .path()
                        .app_data_dir()
                        .map(|d| d.join("logs").join("server.log"))
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    open_window(
                        &handle,
                        WebviewUrl::App("index.html".into()),
                        Some(format!(
                            "The Prax server did not become ready. See the log at {logs}"
                        )),
                    );
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Prax application")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => kill_server(app),
            _ => {}
        });
}
