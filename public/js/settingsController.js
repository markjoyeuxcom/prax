// Settings — controller: preferences, the Intelligence providers (semantic
// search and answer model), Google Calendar, the desktop capture shortcut,
// maintenance and the deployment status card. Dependencies are injected
// (inboxController.js pattern); handleAction delegates the settings
// data-actions here, and the delegated input/change listeners its fields.

import {
  fetchDeploymentStatus, fetchSemanticStatus, setSemanticEnabled, putSemanticSettings, reindexEmbeddings,
  fetchChatStatus, putChatSettings, fetchGoogleCalendarStatus, putGoogleCalendarSettings,
  connectGoogleCalendar, syncGoogleCalendar, disconnectGoogleCalendar, fetchStaleDocuments,
  fetchCaptureShortcut, saveCaptureShortcut,
} from './libraryApi.js';
import {
  applyPreferences, savePreferences, resetPreferences,
  SLIPPAGE_DEFERRAL_OPTIONS, SLIPPAGE_AGE_OPTIONS, WIP_LIMIT_OPTIONS,
} from './preferences.js';
import { settingsPatchMatchesStatus, chatSettingsDraftFrom } from './settingsOutcome.js';
import { sharedAction } from './actionMap.js';

export function createSettingsController({
  getState, setState, renderApp, showToast, alertError, openConfirm, getRoot, prepareEditorNavigation,
  inboxProjectId, resetSemanticSearchPatch, checkDueReminders, destroyEditorController,
  win = globalThis.window,
}) {
  let isReindexing = false;         // guards the reindex/rebuild handler from double-runs
  let gcalPollToken = 0;            // stale Google-connect polls (left Settings / newer op) never install

  async function loadDeploymentStatus() {
    setState({ deploymentStatus: { loading: true, error: '' } });
    try {
      const status = await fetchDeploymentStatus();
      setState({ deploymentStatus: { ...status, loading: false, error: '' } });
    } catch {
      setState({
        deploymentStatus: {
          loading: false,
          error: 'Prax could not load the deployment security status.',
        },
      });
    }
  }

  async function loadSemanticStatus() {
    const state = getState();
    setState({ semanticStatus: { ...state.semanticStatus, loading: true, loadError: '' } });
    try {
      setState({ semanticStatus: { ...(await fetchSemanticStatus()), loading: false, loadError: '' } });
    } catch {
      setState({
        semanticStatus: {
          ...state.semanticStatus,
          loading: false,
          loadError: 'Prax could not load semantic-search settings.',
        },
      });
    }
  }

  async function loadChatStatus() {
    const state = getState();
    setState({ chatStatus: { ...state.chatStatus, loading: true, loadError: '' } });
    try {
      setState({ chatStatus: { ...(await fetchChatStatus()), loading: false, loadError: '' } });
    } catch {
      setState({
        chatStatus: {
          ...state.chatStatus,
          loading: false,
          loadError: 'Prax could not load answer-model settings.',
        },
      });
    }
  }

  async function loadGoogleCalendarStatus() {
    const state = getState();
    setState({ googleCalendarStatus: { ...(state.googleCalendarStatus || {}), loading: true, loadError: '' } });
    try {
      setState({ googleCalendarStatus: { ...(await fetchGoogleCalendarStatus()), loading: false, loadError: '' } });
    } catch {
      setState({
        googleCalendarStatus: {
          ...(state.googleCalendarStatus || {}),
          loading: false,
          loadError: 'Prax could not load Google Calendar settings.',
        },
      });
    }
  }

  // Google-connect polling: consent happens in an external browser tab and the
  // app only learns the outcome when the OAuth callback lands on the server.
  // Poll the status endpoint (3s, up to 2 minutes) until `connected` flips, and
  // go stale silently when the user leaves Settings or a newer connect /
  // disconnect bumps the token.
  const GCAL_POLL_INTERVAL_MS = 3000;
  const GCAL_POLL_MAX_ATTEMPTS = 40; // 40 × 3s = 2 minutes

  function stopGoogleCalendarPolling() {
    gcalPollToken += 1;
  }

  function startGoogleCalendarPolling() {
    const state = getState();
    gcalPollToken += 1;
    const token = gcalPollToken;
    let attempts = 0;
    const tick = async () => {
      if (token !== gcalPollToken) return;
      if (state.navType !== 'settings') return; // user left Settings — stop quietly
      attempts += 1;
      try {
        const status = await fetchGoogleCalendarStatus();
        if (token !== gcalPollToken) return;
        if (status.connected) {
          setState({
            googleCalendarStatus: { ...status, loading: false, loadError: '' },
            googleCalendarNotice: 'Google Calendar connected — the dedicated “Prax” calendar is ready.',
          });
          if (state.navType === 'settings') renderApp();
          return;
        }
      } catch { /* transient poll failure — keep waiting for the callback */ }
      if (token !== gcalPollToken) return;
      if (attempts >= GCAL_POLL_MAX_ATTEMPTS) {
        setState({ googleCalendarNotice: 'Google sign-in did not complete. Click Connect to try again.' });
        if (state.navType === 'settings') renderApp();
        return;
      }
      setTimeout(tick, GCAL_POLL_INTERVAL_MS);
    };
    setTimeout(tick, GCAL_POLL_INTERVAL_MS);
  }

  async function reconcileSemanticSettingsMutation(patch, error) {
    const state = getState();
    const previousStatus = state.semanticStatus;
    try {
      const status = { ...(await fetchSemanticStatus()), loading: false, loadError: '' };
      const applied = settingsPatchMatchesStatus(patch, status, previousStatus);
      setState({
        semanticStatus: status,
        intelligenceSettingsPending: false,
        semanticSettingsDraft: applied ? null : state.semanticSettingsDraft,
      });
      showToast(applied
        ? 'Semantic-search settings were saved; Prax recovered the current status after the response failed.'
        : `${error?.message || 'Prax could not save the semantic-search settings.'} Current settings were reloaded; review before retrying.`);
    } catch {
      setState({
        intelligenceSettingsPending: false,
        semanticStatus: {
          ...state.semanticStatus,
          loading: false,
          loadError: 'Prax could not confirm the semantic-search settings outcome.',
        },
      });
      showToast('Prax could not confirm the semantic-search settings outcome. Reload status before retrying.');
    }
    renderApp();
  }

  async function reconcileChatSettingsMutation(patch, error) {
    const state = getState();
    const previousStatus = state.chatStatus;
    try {
      const status = { ...(await fetchChatStatus()), loading: false, loadError: '' };
      const applied = settingsPatchMatchesStatus(patch, status, previousStatus);
      setState({
        chatStatus: status,
        intelligenceSettingsPending: false,
        chatSettingsDraft: applied ? null : state.chatSettingsDraft,
      });
      showToast(applied
        ? 'Answer-model settings were saved; Prax recovered the current status after the response failed.'
        : `${error?.message || 'Prax could not save the answer-model settings.'} Current settings were reloaded; review before retrying.`);
    } catch {
      setState({
        intelligenceSettingsPending: false,
        chatStatus: {
          ...state.chatStatus,
          loading: false,
          loadError: 'Prax could not confirm the answer-model settings outcome.',
        },
      });
      showToast('Prax could not confirm the answer-model settings outcome. Reload status before retrying.');
    }
    renderApp();
  }

  async function loadMaintenance() {
    const state = getState();
    const project = state.maintenanceProjectFilter === 'all' ? '' : state.maintenanceProjectFilter;
    try {
      setState({ staleDocs: await fetchStaleDocuments(project) });
    } catch {
      setState({ staleDocs: [] });
    }
  }

  async function goSettings() {
    const state = getState();
    if (!(await prepareEditorNavigation())) return false;
    const validDestination = state.projects.some(project => project.id === state.navId)
      ? state.navId
      : (inboxProjectId() || state.projects[0]?.id || null);
    setState({ navType: 'settings', editorFocus: false, adminImportProjectId: validDestination });
    loadDeploymentStatus().then(renderApp);
    loadSemanticStatus().then(renderApp);
    loadChatStatus().then(renderApp);
    loadGoogleCalendarStatus().then(renderApp);
    loadMaintenance().then(renderApp);
    renderApp();
    return true;
  }

  function toggleTheme() {
    const state = getState();
    const preferences = savePreferences({
      ...state.preferences,
      theme: state.preferences.theme === 'dark' ? 'light' : 'dark',
    });
    setState({ preferences });
    applyPreferences(preferences);
    renderApp();
  }

  // Desktop-only settings surface; a failed load leaves the row on its
  // placeholder default rather than inventing a value.
  async function loadCaptureShortcut() {
    const state = getState();
    if (!state.desktopShell || state.captureShortcut) return;
    try {
      const loaded = await fetchCaptureShortcut();
      setState({ captureShortcut: loaded });
      if (state.navType === 'settings') renderApp();
    } catch { /* row keeps its placeholder */ }
  }

  // Delegated `input` events of settings fields. Returns true when handled.
  function input(target) {
    const state = getState();
    if (target.matches?.('[data-gcal-client-id]')) {
      // Mirror to state (no re-render) so the OAuth draft survives re-renders
      // without stealing focus — the render reads googleCalendarDraft back.
      setState({ googleCalendarDraft: { ...state.googleCalendarDraft, clientId: target.value } });
      return true;
    }
    if (target.matches?.('[data-gcal-client-secret]')) {
      setState({ googleCalendarDraft: { ...state.googleCalendarDraft, clientSecret: target.value } });
      return true;
    }
    return false;
  }

  // Delegated `change` events of settings fields. Returns true when handled.
  function change(target) {
    const state = getState();
    if (target.matches?.('[data-reading-scale]')) {
      const preferences = savePreferences({ ...state.preferences, readingScale: Number(target.value) });
      setState({ preferences });
      applyPreferences(preferences);
      renderApp();
      return true;
    }
    if (target.matches?.('[data-maintenance-project-filter]')) {
      setState({ maintenanceProjectFilter: target.value });
      loadMaintenance().then(renderApp);
      return true;
    }
    return false;
  }

  const actions = {
    'set-settings-tab': (el) => {
      const state = getState();
      setState({ settingsTab: el.dataset.tab });
      // Integrations loads lazily: fetch the Google Calendar status the first
      // time the tab opens (goSettings also primes it on entering Settings).
      if (el.dataset.tab === 'integrations' && !state.googleCalendarStatus) {
        loadGoogleCalendarStatus().then(renderApp);
      }
      renderApp();
    },
    'refresh-deployment-status': () => {
      loadDeploymentStatus().then(renderApp); renderApp();
    },
    'apply-capture-shortcut': async () => {
      const input = getRoot().querySelector('[data-capture-shortcut]');
      if (!input) return;
      const shortcut = input.value.trim();
      try {
        const saved = await saveCaptureShortcut(shortcut);
        let notice;
        if (win.__TAURI__?.core?.invoke) {
          try {
            await win.__TAURI__.core.invoke('set_capture_shortcut', { shortcut });
            notice = shortcut ? `Registered ${shortcut}.` : 'Shortcut off — the tray Capture item still works.';
          } catch (err) {
            // Saved but NOT registered: the shell's verdict is the truth.
            notice = `Saved, but not active: ${String(err)}`;
          }
        } else {
          notice = 'Saved. Takes effect in the desktop app.';
        }
        setState({ captureShortcut: saved, captureShortcutNotice: notice });
      } catch (err) {
        setState({ captureShortcutNotice: err?.message || 'Could not save the shortcut.' });
      }
      renderApp();
    },
    'set-list-density': (el) => {
      const state = getState();
      setState({ preferences: applyPreferences(savePreferences({ ...state.preferences, listDensity: el.dataset.density })) });
      renderApp();
    },
    // ---- settings ----
    ...sharedAction('set-theme', 'set-accent', 'set-chrome', (el, event, action) => {
      const state = getState();
      const patch = action === 'set-theme'
        ? { theme: el.dataset.theme }
        : action === 'set-accent' ? { accent: el.dataset.accent } : { chromeOS: el.dataset.chrome };
      const preferences = savePreferences({ ...state.preferences, ...patch });
      setState({ preferences });
      applyPreferences(preferences);
      renderApp();
    }),
    'toggle-line-numbers': () => {
      const state = getState();
      const preferences = savePreferences({ ...state.preferences, lineNumbers: !state.preferences.lineNumbers });
      setState({ preferences });
      renderApp();
    },
    'toggle-reminders': () => {
      const state = getState();
      const enabled = !state.preferences.reminders;
      const preferences = savePreferences({ ...state.preferences, reminders: enabled });
      setState({ preferences });
      if (enabled) checkDueReminders();
      renderApp();
    },
    'toggle-weekly-review-nudge': () => {
      const state = getState();
      setState({ preferences: savePreferences({ ...state.preferences, weeklyReviewNudge: !state.preferences.weeklyReviewNudge }) });
      renderApp();
    },
    'toggle-shutdown-nudge': () => {
      const state = getState();
      setState({ preferences: savePreferences({ ...state.preferences, shutdownNudge: !state.preferences.shutdownNudge }) });
      renderApp();
    },
    'toggle-slippage-chips': () => {
      const state = getState();
      setState({ preferences: savePreferences({ ...state.preferences, slippageChips: !state.preferences.slippageChips }) });
      renderApp();
    },
    'set-slippage-deferrals': (el) => {
      const state = getState();
      const value = Number(el.dataset.value);
      if (!SLIPPAGE_DEFERRAL_OPTIONS.includes(value)) return;
      setState({ preferences: savePreferences({ ...state.preferences, slippageDeferrals: value }) });
      renderApp();
    },
    'set-slippage-age': (el) => {
      const state = getState();
      const value = Number(el.dataset.value);
      if (!SLIPPAGE_AGE_OPTIONS.includes(value)) return;
      setState({ preferences: savePreferences({ ...state.preferences, slippageAgeDays: value }) });
      renderApp();
    },
    'set-wip-limit': (el) => {
      const state = getState();
      const value = Number(el.dataset.value);
      if (!WIP_LIMIT_OPTIONS.includes(value)) return;
      setState({ preferences: savePreferences({ ...state.preferences, wipLimit: value }) });
      renderApp();
    },
    'set-editor-font': (el) => {
      const state = getState();
      const preferences = savePreferences({ ...state.preferences, editorFont: el.dataset.font });
      setState({ preferences });
      applyPreferences(preferences); // flips <body data-editor-font> → --editor-font
      destroyEditorController(); // remount so CodeMirror re-measures the new font
      renderApp();
    },
    'set-preview-font': (el) => {
      const state = getState();
      const preferences = savePreferences({ ...state.preferences, previewFont: el.dataset.font });
      setState({ preferences });
      applyPreferences(preferences); // flips <body data-preview-font> → --prose-font (CSS-only)
      renderApp();
    },
    'enable-desktop-notifications': async () => {
      // A user gesture — the only context in which the browser will show the
      // permission prompt. Once granted, checkDueReminders fires native ones.
      try { if (typeof Notification !== 'undefined') await Notification.requestPermission(); }
      catch { /* unsupported / dismissed */ }
      renderApp();
    },
    'reset-preferences': () => {
      const preferences = resetPreferences();
      setState({ preferences });
      applyPreferences(preferences);
      renderApp();
    },
    'set-ai-provider': async (el) => {
      const state = getState();
      if (state.intelligenceSettingsPending || state.semanticStatus?.loadError) return;
      const patch = { backend: el.dataset.backend };
      setState({ intelligenceSettingsPending: true, semanticSettingsDraft: null });
      renderApp();
      try {
        const status = await putSemanticSettings(patch);
        setState({
          semanticStatus: { ...status, loading: false, loadError: '' },
          intelligenceSettingsPending: false,
          semanticSettingsDraft: null,
          librarySemantic: false,
          ...resetSemanticSearchPatch(),
        });
      } catch (err) {
        await reconcileSemanticSettingsMutation(patch, err);
        return;
      }
      renderApp();
    },
    'save-ai-provider': async () => {
      const state = getState();
      if (state.intelligenceSettingsPending || state.semanticStatus?.loadError) return;
      const patch = {};
      const model = getRoot().querySelector('[data-ai-model]');
      if (model) patch.model = model.value.trim();
      const baseUrl = getRoot().querySelector('[data-ai-base-url]');
      // Only send a non-empty base URL: the server rejects '' as an invalid URL
      // (400), which would sink an otherwise model-only save. Mirrors the apiKey
      // guard below.
      if (baseUrl && baseUrl.value.trim()) patch.baseUrl = baseUrl.value.trim();
      const key = getRoot().querySelector('[data-ai-key]');
      if (key && key.value.trim()) patch.apiKey = key.value.trim();
      const draft = {
        backend: state.semanticStatus?.backend || 'none',
        model: model?.value || '',
        baseUrl: baseUrl?.value || '',
        apiKey: key?.value || '',
      };
      setState({ intelligenceSettingsPending: true, semanticSettingsDraft: draft });
      renderApp();
      try {
        const status = await putSemanticSettings(patch);
        setState({
          semanticStatus: { ...status, loading: false, loadError: '' },
          intelligenceSettingsPending: false,
          semanticSettingsDraft: null,
        });
        showToast(status.connected
          ? `Connected to ${status.backend} — embeddings ready.`
          : `Saved, but ${status.backend || 'the backend'} is not reachable yet.`);
      } catch (err) {
        await reconcileSemanticSettingsMutation(patch, err);
        return;
      }
      renderApp();
    },
    'toggle-semantic-search': async () => {
      const state = getState();
      if (state.intelligenceSettingsPending || state.semanticStatus?.loadError) return;
      const patch = { enabled: !state.semanticStatus.enabled };
      setState({ intelligenceSettingsPending: true });
      renderApp();
      try {
        const status = await setSemanticEnabled(patch.enabled);
        setState({
          semanticStatus: { ...status, loading: false, loadError: '' },
          intelligenceSettingsPending: false,
          librarySemantic: false,
          ...resetSemanticSearchPatch(),
        });
      } catch (err) {
        await reconcileSemanticSettingsMutation(patch, err);
        return;
      }
      renderApp();
    },
    'set-ai-chat-provider': async (el) => {
      const state = getState();
      if (state.intelligenceSettingsPending || state.chatStatus?.loadError) return;
      const patch = { backend: el.dataset.backend };
      setState({ intelligenceSettingsPending: true, chatSettingsDraft: null });
      renderApp();
      try {
        const status = await putChatSettings(patch);
        setState({
          chatStatus: { ...status, loading: false, loadError: '' },
          intelligenceSettingsPending: false,
          chatSettingsDraft: null,
        });
      } catch (err) {
        await reconcileChatSettingsMutation(patch, err);
        return;
      }
      renderApp();
    },
    'save-ai-chat': async () => {
      const state = getState();
      if (state.intelligenceSettingsPending || state.chatStatus?.loadError) return;
      const patch = {};
      const model = getRoot().querySelector('[data-ai-chat-model]');
      if (model) patch.model = model.value.trim();
      const baseUrl = getRoot().querySelector('[data-ai-chat-base-url]');
      if (baseUrl && baseUrl.value.trim()) patch.baseUrl = baseUrl.value.trim();
      const key = getRoot().querySelector('[data-ai-chat-key]');
      if (key && key.value.trim()) patch.apiKey = key.value.trim();
      const binary = getRoot().querySelector('[data-ai-chat-binary]');
      if (binary) patch.binaryPath = binary.value.trim();
      const draft = chatSettingsDraftFrom(state.chatStatus?.backend, {
        model: model?.value, baseUrl: baseUrl?.value, apiKey: key?.value, binaryPath: binary?.value,
      });
      setState({ intelligenceSettingsPending: true, chatSettingsDraft: draft });
      renderApp();
      try {
        const status = await putChatSettings(patch);
        setState({
          chatStatus: { ...status, loading: false, loadError: '' },
          intelligenceSettingsPending: false,
          chatSettingsDraft: null,
        });
        showToast(status.connected
          ? `Connected to ${status.backend} — Ask Prax can write answers.`
          : `Saved, but ${status.backend || 'the model'} is not reachable yet.`);
      } catch (err) {
        await reconcileChatSettingsMutation(patch, err);
        return;
      }
      renderApp();
    },
    'retry-intelligence-status': async () => {
      const state = getState();
      if (state.intelligenceSettingsPending) return;
      const semantic = loadSemanticStatus();
      const chat = loadChatStatus();
      renderApp();
      await Promise.all([semantic, chat]);
      renderApp();
    },
    // ---- Google Calendar integration ----
    // Every branch keeps failures out of the console: transport errors become
    // googleCalendarNotice text, mirroring the backend's degraded-not-crashed
    // contract.
    'retry-google-calendar-status': () => {
      const state = getState();
      if (state.googleCalendarPending) return;
      loadGoogleCalendarStatus().then(renderApp);
      renderApp();
    },
    'save-google-calendar': async () => {
      const state = getState();
      if (state.googleCalendarPending) return;
      const draft = state.googleCalendarDraft || { clientId: '', clientSecret: '' };
      const patch = {};
      // Only send non-empty fields: PUT '' would wipe a saved value, and the
      // secret input is legitimately empty when '(saved)' is shown.
      if ((draft.clientId || '').trim()) patch.clientId = draft.clientId.trim();
      if ((draft.clientSecret || '').trim()) patch.clientSecret = draft.clientSecret.trim();
      if (!patch.clientId && !patch.clientSecret) {
        setState({ googleCalendarNotice: 'Enter the OAuth client id and secret before saving.' });
        renderApp();
        return;
      }
      setState({ googleCalendarPending: true, googleCalendarNotice: 'Saving the OAuth client…' });
      renderApp();
      try {
        const status = await putGoogleCalendarSettings(patch);
        setState({
          googleCalendarStatus: { ...status, loading: false, loadError: '' },
          googleCalendarPending: false,
          // The secret is write-only: clear it from the draft once saved so a
          // later Save cannot resend a stale one — the field now shows the
          // '(saved)' placeholder instead.
          googleCalendarDraft: { clientId: draft.clientId, clientSecret: '' },
          googleCalendarNotice: status.configured
            ? 'OAuth client saved — click Connect to sign in with Google.'
            : 'Saved. Add the missing client id or secret to finish configuring.',
        });
      } catch (err) {
        setState({
          googleCalendarPending: false,
          googleCalendarNotice: err?.message || 'Prax could not save the Google Calendar settings.',
        });
      }
      renderApp();
    },
    'connect-google-calendar': async () => {
      const state = getState();
      if (state.googleCalendarPending) return;
      setState({ googleCalendarPending: true, googleCalendarNotice: 'Starting Google sign-in…' });
      renderApp();
      try {
        const { authUrl } = await connectGoogleCalendar();
        win.open(authUrl, '_blank');
        setState({
          googleCalendarPending: false,
          googleCalendarNotice: 'Waiting for the Google sign-in to finish in the opened tab…',
        });
        startGoogleCalendarPolling();
      } catch (err) {
        // 409 (not configured) surfaces the server's actionable message.
        setState({
          googleCalendarPending: false,
          googleCalendarNotice: err?.message || 'Prax could not start the Google sign-in.',
        });
      }
      renderApp();
    },
    'sync-google-calendar': async () => {
      const state = getState();
      if (state.googleCalendarPending) return;
      setState({ googleCalendarPending: true, googleCalendarNotice: 'Syncing to Google Calendar…' });
      renderApp();
      let notice;
      try {
        const result = await syncGoogleCalendar();
        if (result.degraded && !result.summary) {
          // Whole-sync failure envelope { degraded, reason, message }.
          notice = `Sync failed: ${result.message || result.reason || 'Google Calendar failed'}`;
        } else {
          notice = `Synced: ${result.summary}`;
          if (result.degraded && Array.isArray(result.failures) && result.failures.length) {
            notice += `\n${result.failures
              .map((f) => `Failed: ${f.title || f.eventId || f.taskId || 'item'} — ${f.message || 'unknown error'}`)
              .join('\n')}`;
          }
        }
      } catch (err) {
        notice = err?.message || 'Google Calendar sync failed.';
      }
      // Refresh lastSyncAt/lastSyncSummary; a failed refresh keeps the old
      // status — the notice above already reports the sync outcome.
      try {
        setState({ googleCalendarStatus: { ...(await fetchGoogleCalendarStatus()), loading: false, loadError: '' } });
      } catch { /* keep the previous status */ }
      setState({ googleCalendarPending: false, googleCalendarNotice: notice });
      renderApp();
    },
    'disconnect-google-calendar': async (el, event, action) => {
      const state = getState();
      if (!el.dataset.confirmed) {
        openConfirm({
          message: 'Disconnect Google Calendar? The “Prax” calendar stays in your Google account; Prax just stops pushing to it.',
          okLabel: 'Disconnect', danger: true,
          action: 'disconnect-google-calendar',
        });
        return;
      }
      setState({ confirm: null });
      if (state.googleCalendarPending) { renderApp(); return; }
      stopGoogleCalendarPolling();
      setState({ googleCalendarPending: true, googleCalendarNotice: 'Disconnecting…' });
      renderApp();
      try {
        const status = await disconnectGoogleCalendar();
        setState({
          googleCalendarStatus: { ...status, loading: false, loadError: '' },
          googleCalendarPending: false,
          googleCalendarNotice: 'Disconnected. The “Prax” calendar remains in Google Calendar.',
        });
      } catch {
        setState({
          googleCalendarPending: false,
          googleCalendarNotice: 'Prax could not disconnect Google Calendar. Reload the status and try again.',
        });
      }
      renderApp();
    },
    ...sharedAction('reindex-embeddings', 'force-reindex-embeddings', async (el, event, action) => {
      const state = getState();
      const force = action === 'force-reindex-embeddings';
      if (force && !el.dataset.confirmed) {
        openConfirm({
          message: 'Rebuild embeddings for every document?',
          okLabel: 'Rebuild', action: 'force-reindex-embeddings',
        });
        return;
      }
      if (isReindexing) return; // ignore repeat clicks while one is running
      isReindexing = true;
      // Close the confirm dialog immediately and show progress — a rebuild can
      // take a while against a remote/large model, and leaving the dialog up (it
      // only closed after the whole run finished) read as "the button did
      // nothing". showToast re-renders, so the dialog is gone right away.
      if (state.confirm) setState({ confirm: null });
      showToast(force ? 'Rebuilding every embedding…' : 'Re-indexing…');
      try {
        const result = await reindexEmbeddings(force);
        await loadSemanticStatus();
        const embedded = Number(result?.embedded) || 0;
        const failed = Number(result?.failed) || 0;
        if (failed) {
          const reason = result?.sampleError ? ` (${result.sampleError})` : '';
          showToast(`Re-index: embedded ${embedded}, ${failed} failed${reason}`, null, 6000);
        } else if (embedded) {
          showToast(`Re-indexed ${embedded} document${embedded === 1 ? '' : 's'}.`);
        } else {
          showToast('Embeddings are already up to date.');
        }
      } catch { alertError('reindex embeddings'); }
      finally { isReindexing = false; }
      renderApp();
    }),
    'refresh-maintenance': async () => {
      await loadMaintenance(); renderApp();
    },
  };

  return {
    actions, input, change, goSettings, toggleTheme, loadCaptureShortcut, loadDeploymentStatus,
    loadSemanticStatus, loadChatStatus, loadGoogleCalendarStatus, loadMaintenance,
  };
}
