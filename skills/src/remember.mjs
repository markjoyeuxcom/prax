// Source of the prax-remember skill script. `npm run skills:build` bundles it
// (with cli/lib) into skills/prax-remember/scripts/remember.mjs — a single file
// with no dependencies, so the skill runs from any machine that has Node 20+
// and a reachable Prax, without a checkout of this repo.
//
// Writes agent memory (kind: synthesized, tagged `memory`) to the `memory`
// project by default, stamped with the calling agent's id when known.
import { createClient } from '../../cli/lib/apiClient.js';
import { remember } from '../../cli/lib/remember.js';
import { parseRememberArgs, UsageError } from '../../cli/lib/skillArgs.js';

async function main() {
  const { title, body, tags, type, project, ref, agent } = parseRememberArgs(process.argv.slice(2));
  const client = createClient({ agent });
  const { doc, action } = await remember(client, {
    title, body, project, type, tags: ['memory', ...tags], kind: 'synthesized',
  });
  let refNote = '';
  if (ref) {
    // Best-effort: the memory is already saved; a rejected URL must not undo that.
    try {
      await client.addExternalRef(doc.id, { url: ref });
      refNote = `, ref attached`;
    } catch (err) {
      console.error(`warning: could not attach --ref ${ref}: ${err.message}`);
      refNote = ', ref NOT attached';
    }
  }
  const who = client.agent ? `, as ${client.agent}` : '';
  // Name the instance the write landed in: discovery may have chosen the
  // desktop app or the dev server, and a memory in the wrong workspace must
  // never look identical to one in the right place.
  console.log(`Remembered "${title}" → ${doc.id} (${action}${who}${refNote}) at ${client.base}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(err instanceof UsageError ? 2 : 1);
});
