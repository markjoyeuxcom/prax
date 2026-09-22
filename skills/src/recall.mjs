// Source of the prax-recall skill script. `npm run skills:build` bundles it
// (with cli/lib) into skills/prax-recall/scripts/recall.mjs — a single file
// with no dependencies, so the skill runs from any machine that has Node 20+
// and a reachable Prax, without a checkout of this repo.
import { createClient } from '../../cli/lib/apiClient.js';
import { recall, formatRecall } from '../../cli/lib/recall.js';
import { parseRecallArgs, UsageError } from '../../cli/lib/skillArgs.js';
import { createCheckout } from '../../cli/lib/repoFiles.js';

async function main() {
  const { query, project, limit, recent, agent } = parseRecallArgs(process.argv.slice(2));
  const client = createClient({ agent });
  // A checkout only when this runs inside one: staleness is checked where the
  // working tree is, and only for citations taken in this same repository.
  // Anything not checked is said, never implied to still hold.
  const result = await recall(client, { query, project, limit, recent, checkout: createCheckout() });
  console.log(formatRecall(result));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(err instanceof UsageError ? 2 : 1);
});
