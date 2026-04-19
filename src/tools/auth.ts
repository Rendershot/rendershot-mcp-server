/**
 * Shared Zod schema for authenticated-render options used by screenshot,
 * PDF, and bulk tools. Keeps the three tools' header/cookie/basic_auth
 * shapes in lock-step with each other and with the backend.
 */

import { z } from "zod";

const cookieSchema = z.object({
  name: z.string().describe("Cookie name."),
  value: z.string().describe("Cookie value."),
  domain: z.string().optional().describe("Cookie domain (required if 'url' is not set)."),
  path: z.string().optional().describe("Cookie path."),
  url: z.string().url().optional().describe("Cookie URL (required if 'domain' is not set)."),
  expires: z.number().optional().describe("Unix-seconds expiry."),
  http_only: z.boolean().optional().describe("HttpOnly flag."),
  secure: z.boolean().optional().describe("Secure flag."),
  same_site: z.enum(["Lax", "Strict", "None"]).optional().describe("SameSite policy."),
});

const basicAuthSchema = z.object({
  username: z.string(),
  password: z.string(),
});

/** Schema fragment to merge into each render tool's input schema. */
export const authFieldsSchema = {
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Custom HTTP headers to send with the render request. Use for Bearer tokens, X-Tenant-Id, etc. Host / Cookie / Content-Length / Sec-* / Connection are rejected server-side. Max 30 headers, values ≤ 2 KB.",
    ),
  cookies: z
    .array(cookieSchema)
    .max(50)
    .optional()
    .describe(
      "Session cookies to inject before page navigation. Each cookie needs either 'domain' or 'url'. Max 50 per request.",
    ),
  basic_auth: basicAuthSchema
    .optional()
    .describe(
      "HTTP Basic auth credentials. Forwarded to the headless browser on a 401 challenge.",
    ),
};

/**
 * Optional auth fields as they appear in tool-handler arg objects, after
 * Zod parsing. Also the shape accepted by the backend — no transformation
 * needed beyond dropping undefined values.
 */
export type AuthRenderArgs = {
  headers?: Record<string, string>;
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    url?: string;
    expires?: number;
    http_only?: boolean;
    secure?: boolean;
    same_site?: "Lax" | "Strict" | "None";
  }>;
  basic_auth?: { username: string; password: string };
};

/** Add auth fields to a render-payload dict if set. Mutates ``payload``. */
export function applyAuthToPayload(
  payload: Record<string, unknown>,
  args: AuthRenderArgs,
): void {
  if (args.headers && Object.keys(args.headers).length > 0) {
    payload.headers = args.headers;
  }
  if (args.cookies && args.cookies.length > 0) {
    payload.cookies = args.cookies;
  }
  if (args.basic_auth) {
    payload.basic_auth = args.basic_auth;
  }
}
