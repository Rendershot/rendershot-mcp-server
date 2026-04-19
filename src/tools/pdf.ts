import fs from "node:fs/promises";
import { z } from "zod";
import { RendershotClient, RendershotError } from "../client.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { authFieldsSchema, applyAuthToPayload, type AuthRenderArgs } from "./auth.js";

export const pdfSchema = {
  url: z.string().url().optional().describe("URL of the page to render. Exactly one of url or html is required."),
  html: z.string().max(5 * 1024 * 1024).optional().describe("Raw HTML to render. Exactly one of url or html is required."),
  format: z.enum(["A3", "A4", "Letter", "Legal"]).default("A4").describe("Paper size."),
  orientation: z.enum(["portrait", "landscape"]).default("portrait").describe("Page orientation."),
  print_background: z.boolean().default(true).describe("Print background graphics and colors."),
  wait_for: z.string().default("dom_content_loaded").describe("When to consider the page loaded: load | dom_content_loaded | network_idle | commit | CSS selector."),
  delay_ms: z.number().int().min(0).max(10000).default(0).describe("Extra delay in milliseconds after page load before capturing."),
  ai_cleanup: z.enum(["fast", "thorough"]).optional().describe("Remove cookie banners/popups before capture. 'fast' uses JS heuristics (1 credit). 'thorough' adds an LLM pass (3 credits; requires Anthropic key on the server)."),
  ...authFieldsSchema,
  output_path: z.string().optional().describe("Absolute or relative path to save the PDF file (e.g. /tmp/invoice.pdf). If omitted, the PDF is returned as base64 in the response."),
};

type PDFArgs = AuthRenderArgs & {
  url?: string;
  html?: string;
  format: "A3" | "A4" | "Letter" | "Legal";
  orientation: "portrait" | "landscape";
  print_background: boolean;
  wait_for: string;
  delay_ms: number;
  ai_cleanup?: "fast" | "thorough";
  output_path?: string;
};

export async function handlePDF(args: PDFArgs, client: RendershotClient) {
  if (!args.url && !args.html) {
    throw new McpError(ErrorCode.InvalidParams, "Exactly one of 'url' or 'html' must be provided.");
  }
  if (args.url && args.html) {
    throw new McpError(ErrorCode.InvalidParams, "Provide either 'url' or 'html', not both.");
  }

  const payload: Record<string, unknown> = {
    url: args.url,
    html: args.html,
    format: args.format,
    orientation: args.orientation,
    print_background: args.print_background,
    wait_for: args.wait_for,
    delay_ms: args.delay_ms,
    ai_cleanup: args.ai_cleanup,
    async: true,
  };
  applyAuthToPayload(payload, args);

  let jobId: string;
  try {
    const response = (await client.post("/v1/pdf", payload)) as { job_id: string };
    jobId = response.job_id;
  } catch (err) {
    if (err instanceof McpError) throw err;
    if (err instanceof RendershotError) {
      throw new McpError(ErrorCode.InternalError, err.message);
    }
    throw err;
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await client.pollUntilDone(jobId);
  } catch (err) {
    if (err instanceof RendershotError) {
      throw new McpError(ErrorCode.InternalError, err.message);
    }
    throw err;
  }

  if (args.output_path) {
    await fs.writeFile(args.output_path, Buffer.from(bytes));
    return {
      content: [{ type: "text" as const, text: `PDF saved to ${args.output_path}` }],
    };
  }

  const base64 = Buffer.from(bytes).toString("base64");

  return {
    content: [
      {
        type: "text" as const,
        text: `PDF result (base64-encoded application/pdf):\n${base64}`,
      },
    ],
  };
}
