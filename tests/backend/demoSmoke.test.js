import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise the actual demo wiring, including its explicit process-local receipts.
test('demo supports conditional document edits and deduplicated assistant approvals', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../scripts/demo-server.js', import.meta.url))], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', EMBEDDING_BACKEND: 'none', CHAT_BACKEND: 'fake' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Demo readiness timeout: ${output}`)), 8000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Demo exited ${code}: ${output}`)); });
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
        output += data;
        const match = output.match(/Server listening at (http:\/\/127.0.0.1:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    async function request(path, method = 'GET', body, status = 200) {
      const response = await fetch(origin + path, {
        method, signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json', connection: 'close' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result));
      return result;
    }
    const [doc] = await request('/api/library/documents');
    assert.match(doc.revision, /^[a-f0-9]{64}$/);
    const saved = await request(`/api/library/documents/${doc.id}`, 'PATCH', { body: 'Conditional demo edit', ifRevision: doc.revision });
    assert.notEqual(saved.revision, doc.revision);
    await request(`/api/library/documents/${doc.id}`, 'PATCH', { title: 'Stale rename', ifRevision: doc.revision }, 409);
    assert.equal((await request(`/api/library/documents/${doc.id}/verify`, 'POST', { verified: true, revision: saved.revision })).verified, true);
    const proposal = await request('/api/assistant/chat', 'POST', { messages: [{ role: 'user', content: 'call create_task {"title":"Demo approval once","project":"personal"}' }] });
    assert.equal(proposal.status, 'awaiting_confirmation');
    const approval = { messages: proposal.messages, decisions: { [proposal.pending[0].id]: 'approve' } };
    const first = await request('/api/assistant/chat', 'POST', approval);
    assert.equal(first.didWrite, true);
    assert.equal((await request('/api/assistant/chat', 'POST', approval)).didWrite, true);
    assert.equal((await request('/api/tasks')).filter(task => task.title === 'Demo approval once').length, 1);
  } finally {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
  }
});
