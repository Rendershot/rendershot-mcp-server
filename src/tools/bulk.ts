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

  // Poll all queued jobs concurrently
  const results = await Promise.all(
    bulk.jobs.map(async (jobResult) => {
      if (!jobResult.job_id || jobResult.error_code) {
        return {
          index: jobResult.index,
          error: jobResult.error_code ?? "SUBMISSION_FAILED",
          error_message: jobResult.error_message ?? "Job failed to submit",
          result: null,
        };
      }
      try {
        const bytes = await client.pollUntilDone(jobResult.job_id);
        const base64 = Buffer.from(bytes).toString("base64");
        return { index: jobResult.index, error: null, error_message: null, result: base64 };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { index: jobResult.index, error: "POLL_FAILED", error_message: message, result: null };
      }
    }),
  );

  const summary = {
    credits_used: bulk.credits_used,
    credits_remaining: bulk.credits_remaining,
    submitted: bulk.submitted,
    failed: bulk.failed,
    results,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
  };
}
