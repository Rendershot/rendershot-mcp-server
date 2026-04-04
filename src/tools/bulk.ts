import { z } from "zod";
import { RendershotClient, RendershotError } from "../client.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

const ScreenshotJobSchema = z.object({
  type: z.literal("screenshot"),
  url: z.string().url().optional(),
  html: z.string().max(5 * 1024 * 1024).optional(),
  format: z.enum(["png", "jpeg"]).default("png"),
  quality: z.number().int().min(1).max(100).default(85),
  viewport_width: z.number().int().min(1).max(3840).default(1280),
  viewport_height: z.number().int().min(1).max(2160).default(720),
  full_page: z.boolean().default(false),
  wait_for: z.string().default("networkidle"),
  delay_ms: z.number().int().min(0).max(10000).default(0),
});

const PDFJobSchema = z.object({
  type: z.literal("pdf"),
  url: z.string().url().optional(),
  html: z.string().max(5 * 1024 * 1024).optional(),
  format: z.enum(["A3", "A4", "Letter", "Legal"]).default("A4"),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  print_background: z.boolean().default(true),
  wait_for: z.string().default("networkidle"),
  delay_ms: z.number().int().min(0).max(10000).default(0),
});

export const bulkSchema = {
  jobs: z
    .array(z.discriminatedUnion("type", [ScreenshotJobSchema, PDFJobSchema]))
    .min(1)
    .max(20)
    .describe("Array of 1–20 screenshot or PDF jobs to render."),
};

type BulkArgs = {
  jobs: z.infer<typeof ScreenshotJobSchema | typeof PDFJobSchema>[];
};

interface BulkJobResult {
  index: number;
  job_id: string | null;
  status: string | null;
  poll_url: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface BulkResponse {
  submitted: number;
  failed: number;
  jobs: BulkJobResult[];
  credits_used: number;
  credits_remaining: number;
}

function buildJobPayload(job: z.infer<typeof ScreenshotJobSchema | typeof PDFJobSchema>): unknown {
  if (job.type === "screenshot") {
    return {
      type: "screenshot",
      url: job.url,
      html: job.html,
      format: job.format,
      quality: job.quality,
      viewport: { width: job.viewport_width, height: job.viewport_height },
      full_page: job.full_page,
      wait_for: job.wait_for,
      delay_ms: job.delay_ms,
    };
  }
  return {
    type: "pdf",
    url: job.url,
    html: job.html,
    format: job.format,
    orientation: job.orientation,
    print_background: job.print_background,
    wait_for: job.wait_for,
    delay_ms: job.delay_ms,
  };
}

export async function handleBulk(args: BulkArgs, client: RendershotClient) {
  for (const [i, job] of args.jobs.entries()) {
    if (!job.url && !job.html) {
      throw new McpError(ErrorCode.InvalidParams, `Job at index ${i}: exactly one of 'url' or 'html' must be provided.`);
    }
    if (job.url && job.html) {
      throw new McpError(ErrorCode.InvalidParams, `Job at index ${i}: provide either 'url' or 'html', not both.`);
    }
  }

  let bulk: BulkResponse;
  try {
    bulk = (await client.post("/v1/bulk", {
      jobs: args.jobs.map(buildJobPayload),
    })) as BulkResponse;
  } catch (err) {
    if (err instanceof McpError) throw err;
    if (err instanceof RendershotError) {
      throw new McpError(ErrorCode.InternalError, err.message);
    }
    throw err;
  }

  // Build a lookup of job index → input format/type so we can set mimeType later
  const jobMeta = new Map(
    args.jobs.map((job, i) => [
      i,
      {
        type: job.type,
        mimeType: job.type === "pdf"
          ? "application/pdf"
          : (job as z.infer<typeof ScreenshotJobSchema>).format === "jpeg"
            ? "image/jpeg"
            : "image/png",
      },
    ]),
  );

  // Poll all queued jobs concurrently
  const results = await Promise.all(
    bulk.jobs.map(async (jobResult) => {
      if (!jobResult.job_id || jobResult.error_code) {
        return {
          index: jobResult.index,
          rendered: false,
          error: jobResult.error_code ?? "SUBMISSION_FAILED",
          error_message: jobResult.error_message ?? "Job failed to submit",
          bytes: null as ArrayBuffer | null,
        };
      }
      try {
        const bytes = await client.pollUntilDone(jobResult.job_id);
        return { index: jobResult.index, rendered: true, error: null, error_message: null, bytes };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { index: jobResult.index, rendered: false, error: "POLL_FAILED", error_message: message, bytes: null };
      }
    }),
  );

  // Build the text summary (no base64 — keeps the tool result small so it fits in the model context)
  const summary = {
    credits_used: bulk.credits_used,
    credits_remaining: bulk.credits_remaining,
    submitted: bulk.submitted,
    failed: bulk.failed,
    results: results.map(({ index, rendered, error, error_message }) => ({
      index,
      rendered,
      error,
      error_message,
    })),
  };

  // Return the summary as text, then each rendered file as a separate content block
  type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string };

  const content: ContentBlock[] = [
    { type: "text", text: JSON.stringify(summary, null, 2) },
  ];

  for (const result of results) {
    if (result.rendered && result.bytes) {
      const meta = jobMeta.get(result.index);
      const mimeType = meta?.mimeType ?? "image/png";
      const base64 = Buffer.from(result.bytes).toString("base64");
      // PDFs don't have a native MCP content type — embed as text with a header
      if (mimeType === "application/pdf") {
        content.push({ type: "text", text: `PDF for job ${result.index} (base64):\n${base64}` });
      } else {
        content.push({ type: "image", data: base64, mimeType });
      }
    }
  }

  return { content };
}
