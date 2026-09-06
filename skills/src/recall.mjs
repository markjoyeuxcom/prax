// Source of the prax-recall skill script. `npm run skills:build` bundles it
// (with cli/lib) into skills/prax-recall/scripts/recall.mjs — a single file
// with no dependencies, so the skill runs from any machine that has Node 20+
// and a reachable Prax, without a checkout of this repo.
import { createClient } from '../../cli/lib/apiClient.js';
import { recall, formatRecall } from '../../cli/lib/recall.js';
import { parseRecallArgs, UsageError } from '../../cli/lib/skillArgs.js';

async function main() {
  const { query, project, limit, recent, agent } = parseRecallArgs(process.argv.slice(2));
  const client = createClient({ agent });
  const result = await recall(client, { query, project, limit, recent });
  console.log(formatRecall(result));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(err instanceof UsageError ? 2 : 1);
});
