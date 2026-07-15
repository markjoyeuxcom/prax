import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

test('container image does not bake in a remotely reachable unauthenticated listener', async () => {
  const dockerfile = await read('deploy/Dockerfile');
  assert.doesNotMatch(dockerfile, /^ENV HOST=/m);
  assert.doesNotMatch(dockerfile, /PRAX_ALLOW_UNAUTHENTICATED_NETWORK/);
});

test('Compose opts the container process in but publishes Prax on host loopback only', async () => {
  const compose = await read('compose.yaml');
  assert.match(compose, /^\s+HOST:\s+0\.0\.0\.0\s*$/m);
  assert.match(compose, /^\s+PRAX_ALLOW_UNAUTHENTICATED_NETWORK:\s+["']true["']\s*$/m);
  assert.match(compose, /^\s+-\s+["']127\.0\.0\.1:3100:3000["']\s*$/m);
  assert.doesNotMatch(compose, /^\s+-\s+["']?(?:0\.0\.0\.0:)?3100:3000["']?\s*$/m);
});

test('rendered Kubernetes base stays internal and makes its pod-network bind explicit', async () => {
  const [config, deployment, service, base] = await Promise.all([
    read('deploy/base/configmap.yaml'),
    read('deploy/base/deployment.yaml'),
    read('deploy/base/service.yaml'),
    read('deploy/base/kustomization.yaml'),
  ]);

  assert.match(config, /^\s+HOST:\s+"0\.0\.0\.0"\s*$/m);
  assert.match(config, /^\s+PRAX_ALLOW_UNAUTHENTICATED_NETWORK:\s+"true"\s*$/m);
  assert.match(deployment, /^\s+replicas:\s+1\s*$/m);
  assert.match(deployment, /^\s+type:\s+Recreate\s*$/m);
  assert.match(service, /^\s+type:\s+ClusterIP\s*$/m);
  assert.doesNotMatch(service, /^\s+externalIPs:\s*$/m);
  assert.doesNotMatch(base, /httproute\.yaml/);
});

test('every shipped overlay inherits the route-free base and the example route cannot publish as-is', async () => {
  const packageVersion = JSON.parse(await read('package.json')).version;
  for (const environment of ['dev', 'staging', 'prod']) {
    const overlay = await read(`deploy/overlays/${environment}/kustomization.yaml`);
    assert.match(overlay, /^\s+-\s+\.\.\/\.\.\/base\s*$/m);
    assert.doesNotMatch(overlay, /httproute\.yaml|kind:\s*HTTPRoute/);
    assert.match(overlay, new RegExp(`^\\s+newTag:\\s+v${packageVersion.replaceAll('.', '\\.')}\\s*$`, 'm'));
  }

  const route = await read('deploy/base/httproute.yaml');
  assert.match(route, /^\s+-\s+prax\.invalid\s*$/m);
  assert.match(route, /OPT-IN EXAMPLE ONLY/);
  assert.match(route, /authentication and TLS/);
});
