// Source of the prax-recall skill script. `npm run skills:build` bundles it
// (with cli/lib) into skills/prax-recall/scripts/recall.mjs — a single file
// with no dependencies, so the skill runs from any machine that has Node 20+
// and a reachable Prax, without a checkout of this repo.
import { createClient } from '../../cli/lib/apiClient.js';
import { recall, formatRecall } from '../../cli/lib/recall.js';
import {
  memoryDelta, planDelta, recordDelta, parseSince,
} from '../../cli/lib/delta.js';
import { parseRecallArgs, UsageError, RECALL_USAGE } from '../../cli/lib/skillArgs.js';
import { createCheckout } from '../../cli/lib/repoFiles.js';

async function main() {
  const {
    query, project, limit, recent, agent, budget, since: sinceArg, sinceLastSession, includeHarvested = false,
  } = parseRecallArgs(process.argv.slice(2));
  const client = createClient({ agent });
  // A checkout only when this runs inside one: staleness is checked where the
  // working tree is, and only for citations taken in this same repository.
  // Anything not checked is said, never implied to still hold.
  const checkout = createCheckout();
  if (sinceLastSession || sinceArg !== undefined) {
    const since = sinceArg === undefined ? undefined : parseSince(sinceArg);
    if (sinceArg !== undefined && !since) {
      throw new UsageError(`--since must be an ISO-8601 date or date-time (got "${sinceArg}")`, RECALL_USAGE);
    }
    if (sinceLastSession && !client.agent) {
      throw new UsageError('--since-last-session needs an agent id: pass --agent <id> or set PRAX_AGENT', RECALL_USAGE);
    }
    const result = await memoryDelta(client, {
      since, sinceLastSession, project: project || undefined, limit, checkout, includeHarvested,
    });
    const planned = planDelta(result, budget ?? Infinity);
    console.log(planned.text);
    // Only after the block is out, and only when nothing was left out.
    if (sinceLastSession && planned.advance) {
      const recorded = await recordDelta(client, result, { project: project || undefined });
      if (recorded.error) console.error(`could not record the delta marker (${recorded.error.message}); the next --since-last-session repeats these changes.`);
    }
    return;
  }
  const result = await recall(client, {
    query, project, limit, recent, budget, checkout, includeHarvested,
  });
  console.log(formatRecall(result));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(err instanceof UsageError ? 2 : 1);
});
