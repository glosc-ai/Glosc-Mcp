import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { GloscMcp } from "./GloscMcp.js";

const mcpServer = new GloscMcp();

async function main() {
    const transport = new StdioServerTransport();
    await mcpServer.server.connect(transport);
    console.error("Weather MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
