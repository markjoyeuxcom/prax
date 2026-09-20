import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchLibraryArchive, libraryArchiveFilename, libraryArchiveUrl, libraryExportDestinationMode,
  libraryExportFailureMessage, saveLibraryArchive,
} from '../../public/js/libraryExport.js';

test('archive filename is stable, scoped, UTC-dated, and filesystem safe', () => {
  const now = new Date('2026-07-13T23:59:59.000Z');
  assert.equal(libraryArchiveFilename('all', now), 'prax-library-all-2026-07-13.zip');
  assert.equal(libraryArchiveFilename('Work / Ops', now), 'prax-library-work-ops-2026-07-13.zip');
});

test('archive inclusion and full workspace format reach their intended endpoints through native saving', async () => {
  assert.equal(libraryArchiveUrl('work', { includeArchived: true }), '/api/library/export?project=work&includeArchived=true');
  let invoked = false;
  const result = await saveLibraryArchive({ scope: 'work', format: 'workspace', mode: 'desktop',
    globalRef: { __TAURI__: { core: { async invoke(command, args) {
      invoked = true; assert.equal(command, 'save_library_export');
      assert.match(args.fileName, /^prax-workspace-/); return '/chosen/full.zip';
    } } } },
    async fetchImpl(url) { assert.equal(url, '/api/workspace/backup'); return new Response(new Blob(['zip'])); },
  });
  assert.equal(invoked, true); assert.equal(result.status, 'saved');
});

test('destination mode prefers desktop invoke, then browser picker, then download', () => {
  const invoke = async () => {};
  assert.equal(libraryExportDestinationMode({
    desktopShell: true,
    globalRef: { __TAURI__: { core: { invoke } }, showSaveFilePicker() {} },
  }), 'desktop');
  assert.equal(libraryExportDestinationMode({ globalRef: { showSaveFilePicker() {} } }), 'browser-picker');
  assert.equal(libraryExportDestinationMode({ desktopShell: true, globalRef: {} }), 'download');
});

test('desktop bridge rejections remain visible instead of collapsing to a generic error', () => {
  assert.equal(
    libraryExportFailureMessage('save_library_export not allowed by capability'),
    'Prax could not create or save the Library archive: save_library_export not allowed by capability',
  );
  assert.equal(
    libraryExportFailureMessage(new Error('disk full')),
    'Prax could not create or save the Library archive: disk full',
  );
  assert.equal(
    libraryExportFailureMessage(null),
    'Prax could not create or save the Library archive.',
  );
});

test('browser picker opens before fetching and writes the archive to the chosen handle', async () => {
  const events = [];
  const payload = new Blob(['zip bytes'], { type: 'application/zip' });
  let written = null;
  const result = await saveLibraryArchive({
    scope: 'work',
    filename: 'prax-library-work-2026-07-13.zip',
    mode: 'browser-picker',
    globalRef: {
      async showSaveFilePicker(options) {
        events.push(['picker', options]);
        return {
          async createWritable() {
            events.push(['writable']);
            return {
              async write(blob) { written = blob; events.push(['write']); },
              async close() { events.push(['close']); },
            };
          },
        };
      },
    },
    async fetchImpl(url) {
      events.push(['fetch', url]);
      return new Response(payload, { status: 200 });
    },
  });

  assert.deepEqual(events.map(([name]) => name), ['picker', 'fetch', 'writable', 'write', 'close']);
  assert.equal(events[0][1].suggestedName, 'prax-library-work-2026-07-13.zip');
  assert.deepEqual(events[0][1].types[0].accept, { 'application/zip': ['.zip'] });
  assert.equal(await written.text(), 'zip bytes');
  assert.deepEqual(result, { status: 'saved', filename: 'prax-library-work-2026-07-13.zip' });
});

test('cancelling the browser picker is neutral and does not fetch an archive', async () => {
  let fetched = false;
  const error = new Error('user cancelled');
  error.name = 'AbortError';
  const result = await saveLibraryArchive({
    mode: 'browser-picker',
    globalRef: { async showSaveFilePicker() { throw error; } },
    async fetchImpl() { fetched = true; },
  });
  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(fetched, false);
});

test('a failed picker write is aborted and remains an error', async () => {
  let aborted = false;
  await assert.rejects(saveLibraryArchive({
    mode: 'browser-picker',
    globalRef: {
      async showSaveFilePicker() {
        return { async createWritable() {
          return {
            async write() { throw new Error('disk full'); },
            async close() {},
            async abort() { aborted = true; },
          };
        } };
      },
    },
    async fetchImpl() { return new Response(new Blob(['zip']), { status: 200 }); },
  }), /disk full/);
  assert.equal(aborted, true);
});

test('desktop export sends archive bytes to the native save command', async () => {
  const calls = [];
  const result = await saveLibraryArchive({
    scope: 'homelab', filename: 'homelab.zip', mode: 'desktop',
    globalRef: { __TAURI__: { core: { async invoke(command, args) {
      calls.push([command, args]);
      return '/chosen/homelab.zip';
    } } } },
    async fetchImpl(url) {
      assert.equal(url, '/api/library/export?project=homelab');
      return new Response(new Uint8Array([1, 2, 255]), { status: 200 });
    },
  });
  assert.deepEqual(calls, [['save_library_export', { fileName: 'homelab.zip', bytes: [1, 2, 255] }]]);
  assert.deepEqual(result, {
    status: 'saved', filename: 'homelab.zip', path: '/chosen/homelab.zip',
  });
});

test('desktop native-dialog cancellation stays neutral', async () => {
  const result = await saveLibraryArchive({
    mode: 'desktop',
    globalRef: { __TAURI__: { core: { async invoke() { return null; } } } },
    async fetchImpl() { return new Response(new Blob(['zip']), { status: 200 }); },
  });
  assert.deepEqual(result, { status: 'cancelled' });
});

test('download fallback starts the scoped browser download without claiming it saved', async () => {
  let clicked = false;
  let appended = null;
  const anchor = { style: {}, click() { clicked = true; } };
  const documentRef = {
    createElement(name) { assert.equal(name, 'a'); return anchor; },
    body: {
      appendChild(value) { appended = value; },
      removeChild(value) { assert.equal(value, anchor); appended = null; },
    },
  };
  const result = await saveLibraryArchive({
    scope: 'work ops', filename: 'work.zip', mode: 'download', documentRef, globalRef: {},
  });
  assert.equal(anchor.href, '/api/library/export?project=work%20ops');
  assert.equal(anchor.download, 'work.zip');
  assert.equal(anchor.style.display, 'none');
  assert.equal(clicked, true);
  assert.equal(appended, null);
  assert.deepEqual(result, { status: 'downloaded', filename: 'work.zip' });
});

test('archive fetch surfaces the server message and rejects unsuccessful responses', async () => {
  await assert.rejects(fetchLibraryArchive('missing', {
    async fetchImpl() {
      return new Response(JSON.stringify({ message: 'project is invalid' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      });
    },
  }), /project is invalid/);
});
