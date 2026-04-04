#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RendershotClient } from "./client.js";
import { screenshotSchema, handleScreenshot } from "./tools/screenshot.js";
import { pdfSchema, handlePDF } from "./tools/pdf.js";
import { bulkSchema, handleBulk } from "./tools/bulk.js";
import { balanceSchema, handleBalance } from "./tools/balance.js";

const apiKey = process.env.RENDERSHOT_API_KEY;
if (!apiKey) {
  console.error("Error: RENDERSHOT_API_KEY environment variable is required.");
  process.exit(1);
}

const baseUrl = process.env.RENDERSHOT_BASE_URL ?? "https://api.rendershot.io";
const client = new RendershotClient(apiKey, baseUrl);

const server = new McpServer({
  name: "rendershot",
  version: "0.1.0",
});

server.tool(
  "take_screenshot",
  "Capture a screenshot of a web page or HTML content. Returns a base64-encoded PNG or JPEG image.",
  screenshotSchema,
  (args) => handleScreenshot(args, client),
);

server.tool(
  "generate_pdf",
  "Generate a PDF from a web page or HTML content. Returns the PDF as a base64-encoded string.",
  pdfSchema,
  (args) => handlePDF(args, client),
);

server.tool(
  "bulk_render",
  "Submit up to 20 screenshot or PDF render jobs in a single request. Returns results for all jobs including base64-encoded output.",
  bulkSchema,
  (args) => handleBulk(args, client),
);

server.tool(
  "check_balance",
  "Check the remaining API credits and current plan details for the configured API key.",
  balanceSchema,
  () => handleBalance(client),
);

const transport = new StdioServerTransport();
await server.connect(transport);
