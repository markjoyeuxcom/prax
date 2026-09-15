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
import { createRepoReader, headSha } from '../../cli/lib/repoFiles.js';
import { resolveCitation } from '../../cli/lib/codeRefs.js';

async function main() {
  const { title, body, tags, type, project, projectExplicit, id, ref, cite, agent } = parseRememberArgs(process.argv.slice(2));
  const client = createClient({ agent });
  // No --project and no --id means "wherever this title already lives": a
  // same-title document in another project is refined there rather than
  // duplicated into memory (recall is cross-project; the write must be too).
  const result = await remember(client, {
    title, body, project, type, tags: ['memory', ...tags], kind: 'synthesized',
    id, crossProject: !projectExplicit && !id,
  });
  const { doc, action } = result;
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
  // --cite pins the code this memory describes, so a later recall can report
  // that the claim's ground has moved. Best-effort, like --ref: the memory is
  // already saved and a bad citation must not undo it.
  let citeNote = '';
  if (cite) {
    try {
      const read = createRepoReader();
      if (!read) throw new Error('not inside a git repository');
      await client.addCodeRef(doc.id, resolveCitation(cite, { readFile: read, headSha: headSha() }));
      citeNote = ', code pinned';
    } catch (err) {
      console.error(`warning: could not attach --cite ${cite}: ${err.message}`);
      citeNote = ', code NOT pinned';
    }
  }
  const who = client.agent ? `, as ${client.agent}` : '';
  // Say WHERE it landed whenever that is not the memory namespace the skill
  // defaults to — a cross-project update or an --id target — so the agent
  // never believes it wrote a memory note when it refined a homelab runbook.
  const where = result.project && result.project !== project ? ` in ${result.project}` : '';
  // Name the instance the write landed in: discovery may have chosen the
  // desktop app or the dev server, and a memory in the wrong workspace must
  // never look identical to one in the right place.
  console.log(`Remembered "${title}" → ${doc.id} (${action}${where}${who}${refNote}${citeNote}) at ${client.base}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(err instanceof UsageError ? 2 : 1);
});
