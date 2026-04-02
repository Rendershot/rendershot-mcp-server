import { z } from "zod";
import { RendershotClient, RendershotError } from "../client.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const pdfSchema = {
  url: z.string().url().optional().describe("URL of the page to render. Exactly one of url or html is required."),
  html: z.string().max(5 * 1024 * 1024).optional().describe("Raw HTML to render. Exactly one of url or html is required."),
  format: z.enum(["A3", "A4", "Letter", "Legal"]).default("A4").describe("Paper size."),
  orientation: z.enum(["portrait", "landscape"]).default("portrait").describe("Page orientation."),
  print_background: z.boolean().default(true).describe("Print background graphics and colors."),
  wait_for: z.string().default("networkidle").describe("When to consider the page loaded: load | domcontentloaded | networkidle | commit | CSS selector."),
  delay_ms: z.number().int().min(0).max(10000).default(0).describe("Extra delay in milliseconds after page load before capturing."),
};

type PDFArgs = {
  url?: string;
  html?: string;
  format: "A3" | "A4" | "Letter" | "Legal";
  orientation: "portrait" | "landscape";
  print_background: boolean;
  wait_for: string;
  delay_ms: number;
};

export async function handlePDF(args: PDFArgs, client: RendershotClient) {
  if (!args.url && !args.html) {
    throw new McpError(ErrorCode.InvalidParams, "Exactly one of 'url' or 'html' must be provided.");
  }
  if (args.url && args.html) {
    throw new McpError(ErrorCode.InvalidParams, "Provide either 'url' or 'html', not both.");
  }

  let jobId: string;
  try {
    const response = (await client.post("/v1/pdf", {
      url: args.url,
      html: args.html,
      format: args.format,
      orientation: args.orientation,
      print_background: args.print_background,
      wait_for: args.wait_for,
      delay_ms: args.delay_ms,
      async: true,
    })) as { job_id: string };
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
