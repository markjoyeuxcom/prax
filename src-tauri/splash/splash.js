const restart = document.getElementById('restart');

// The shell opens this page as the recovery screen with its reason in the
// query string (src-tauri/src/lib.rs recovery_url). Text only, never markup.
const recovery = new URLSearchParams(location.search);
if (recovery.get('state') === 'error') {
  document.body.dataset.state = 'error';
  document.getElementById('heading').textContent = recovery.get('heading') || 'Prax needs to restart';
  document.getElementById('detail').textContent = recovery.get('detail') || 'Restart Prax to recover.';
  if (restart) restart.hidden = false;
}

restart?.addEventListener('click', async () => {
  restart.disabled = true;
  restart.textContent = 'Restarting…';
  document.getElementById('detail').textContent = 'Closing the local database safely before restart…';
  try {
    await globalThis.__TAURI__.core.invoke('restart_prax');
  } catch {
    restart.disabled = false;
    restart.textContent = 'Restart Prax';
    document.getElementById('detail').textContent = 'Prax could not restart automatically. Quit the app and open it again; the diagnostic log remains in your app-data folder.';
  }
});
