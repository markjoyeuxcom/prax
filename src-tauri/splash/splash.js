const restart = document.getElementById('restart');

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
