import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createPraxClient } from './praxClient.js';
import { createDocumentTools } from './tools/documents.js';
import { createTaskTools } from './tools/tasks.js';
import { createLinkTools } from './tools/links.js';
import { createChecklistTools } from './tools/checklist.js';
import { createActivityTools } from './tools/activity.js';
import { createDocumentLinkTools } from './tools/documentLinks.js';
import { createGraphMaintenanceTools } from './tools/graphMaintenance.js';
import { createSemanticSearchTools } from './tools/semanticSearch.js';
import { createRunTools } from './tools/runs.js';
import { createInsightTools } from './tools/insights.js';

// Advertise the package version so the MCP serverInfo never drifts from releases.
const { version: PACKAGE_VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

// The full Prax tool tree bound to a client. Shared by the MCP server (below)
// and the in-app AI assistant (server/assistant), so agents and the built-in
// assistant expose exactly the same capabilities.
export function buildToolset(client) {
  return [
    ...createDocumentTools(client),
    ...createTaskTools(client),
    ...createLinkTools(client),
    ...createChecklistTools(client),
    ...createActivityTools(client),
    ...createDocumentLinkTools(client),
    ...createGraphMaintenanceTools(client),
    ...createSemanticSearchTools(client),
    ...createRunTools(client),
    ...createInsightTools(client),
  ];
}

export function buildServer({ server, client } = {}) {
  const mcp = server || new McpServer({ name: 'prax', version: PACKAGE_VERSION });
  const apiClient = client || createPraxClient();

  const tools = buildToolset(apiClient);

  for (const tool of tools) {
    mcp.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      tool.handler,
    );
  }

  return mcp;
}

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel — log to stderr only.
  console.error('Prax MCP server running on stdio');
}

// Robust "is this the entry module?" check across platforms (handles Windows paths).
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
