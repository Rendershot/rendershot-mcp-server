export class RendershotError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(`[${code}] ${message}`);
    this.name = "RendershotError";
  }
}

interface JobStatus {
  job_id: string;
  status: string;
  error_message: string | null;
  result_url: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RendershotClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(apiKey: string, baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.headers = {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    };
  }

  async post(path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new RendershotError("NETWORK_ERROR", `Could not reach ${this.baseUrl}: ${String(err)}`, 0);
    }
    if (!res.ok) {
      await this.throwApiError(res);
    }
    return res.json();
  }

  async get(path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        headers: this.headers,
      });
    } catch (err) {
      throw new RendershotError("NETWORK_ERROR", `Could not reach ${this.baseUrl}: ${String(err)}`, 0);
    }
    if (!res.ok) {
      await this.throwApiError(res);
    }
    return res.json();
  }

  private async getBytes(path: string): Promise<ArrayBuffer> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        headers: this.headers,
      });
    } catch (err) {
      throw new RendershotError("NETWORK_ERROR", `Could not reach ${this.baseUrl}: ${String(err)}`, 0);
    }
    if (!res.ok) {
      await this.throwApiError(res);
    }
    return res.arrayBuffer();
  }

  private async throwApiError(res: Response): Promise<never> {
    let code = String(res.status);
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // ignore parse errors, use defaults
    }
    throw new RendershotError(code, message, res.status);
  }

  async pollUntilDone(jobId: string): Promise<ArrayBuffer> {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(2000);
      const job = (await this.get(`/v1/jobs/${jobId}`)) as JobStatus;
      // result_url is set only when status=completed AND the file is stored on disk —
      // it is the most reliable signal that the result is ready to download.
      if (job.result_url) {
        return this.getBytes(`/v1/jobs/${jobId}/result`);
      }
      if (job.status === "failed") {
        throw new RendershotError(
          "JOB_FAILED",
          job.error_message ?? "Render job failed",
          422,
        );
      }
    }
    throw new RendershotError(
      "TIMEOUT",
      "Timed out waiting for render job after 5 minutes",
      504,
    );
  }
}
