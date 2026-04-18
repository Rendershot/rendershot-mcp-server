import fs from "node:fs/promises";
import { z } from "zod";
import { RendershotClient, RendershotError } from "../client.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const screenshotSchema = {
  url: z.string().url().optional().describe("URL of the page to screenshot. Exactly one of url or html is required."),
  html: z.string().max(5 * 1024 * 1024).optional().describe("Raw HTML to render. Exactly one of url or html is required."),
  format: z.enum(["png", "jpeg"]).default("png").describe("Image format."),
  quality: z.number().int().min(1).max(100).default(85).describe("JPEG quality (1–100). Ignored for PNG."),
  viewport_width: z.number().int().min(1).max(3840).default(1280).describe("Viewport width in pixels."),
  viewport_height: z.number().int().min(1).max(2160).default(720).describe("Viewport height in pixels."),
  full_page: z.boolean().default(false).describe("Capture the full scrollable page."),
  wait_for: z.string().default("dom_content_loaded").describe("When to consider the page loaded: load | dom_content_loaded | network_idle | commit | CSS selector."),
  delay_ms: z.number().int().min(0).max(10000).default(0).describe("Extra delay in milliseconds after page load before capturing."),
  ai_cleanup: z.enum(["fast", "thorough"]).optional().describe("Remove cookie banners/popups before capture. 'fast' uses JS heuristics (1 credit). 'thorough' adds an LLM pass (3 credits; requires Anthropic key on the server)."),
  output_path: z.string().optional().describe("Absolute or relative path to save the image file (e.g. /tmp/shot.png). If omitted, the image is returned as base64 in the response."),
};

type ScreenshotArgs = {
  url?: string;
  html?: string;
  format: "png" | "jpeg";
  quality: number;
  viewport_width: number;
  viewport_height: number;
  full_page: boolean;
  wait_for: string;
  delay_ms: number;
  ai_cleanup?: "fast" | "thorough";
  output_path?: string;
};

export async function handleScreenshot(args: ScreenshotArgs, client: RendershotClient) {
  if (!args.url && !args.html) {
    throw new McpError(ErrorCode.InvalidParams, "Exactly one of 'url' or 'html' must be provided.");
  }
  if (args.url && args.html) {
    throw new McpError(ErrorCode.InvalidParams, "Provide either 'url' or 'html', not both.");
  }

  let jobId: string;
  try {
    const response = (await client.post("/v1/screenshot", {
      url: args.url,
      html: args.html,
      format: args.format,
      quality: args.quality,
      viewport: { width: args.viewport_width, height: args.viewport_height },
      full_page: args.full_page,
      wait_for: args.wait_for,
      delay_ms: args.delay_ms,
      ai_cleanup: args.ai_cleanup,
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

  if (args.output_path) {
    await fs.writeFile(args.output_path, Buffer.from(bytes));
    return {
      content: [{ type: "text" as const, text: `Screenshot saved to ${args.output_path}` }],
    };
  }

  const base64 = Buffer.from(bytes).toString("base64");
  const mimeType = args.format === "jpeg" ? "image/jpeg" : "image/png";

  return {
    content: [{ type: "image" as const, data: base64, mimeType }],
  };
}
