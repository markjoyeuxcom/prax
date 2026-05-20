import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMoomoraClient } from './moomoraClient.js';
import { createDocumentTools } from './tools/documents.js';
import { createTaskTools } from './tools/tasks.js';
import { createLinkTools } from './tools/links.js';

export function buildServer({ server, client } = {}) {
  const mcp = server || new McpServer({ name: 'moomora-console', version: '0.2.0' });
  const apiClient = client || createMoomoraClient();

  const tools = [
    ...createDocumentTools(apiClient),
    ...createTaskTools(apiClient),
    ...createLinkTools(apiClient),
  ];

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
  console.error('Moomora MCP server running on stdio');
}

// Robust "is this the entry module?" check across platforms (handles Windows paths).
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
