import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Auth } from "./auth.js";
import { Api } from "./api.js";
import { createServer } from "./server.js";

async function main() {
  const auth = new Auth();
  const api = new Api(auth);
  const server = createServer(auth, api);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[peoplelikeus-mcp] Server started");
}

main().catch((err) => {
  console.error("[peoplelikeus-mcp] Fatal:", err);
  process.exit(1);
});
