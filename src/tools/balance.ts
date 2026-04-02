import { RendershotClient, RendershotError } from "../client.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const balanceSchema = {};

interface CreditBalance {
  credits_remaining: number;
  plan_id: string;
  status: string;
  current_period_end: string;
}

export async function handleBalance(client: RendershotClient) {
  let balance: CreditBalance;
  try {
    balance = (await client.get("/v1/balance")) as CreditBalance;
  } catch (err) {
    if (err instanceof RendershotError) {
      throw new McpError(ErrorCode.InternalError, err.message);
    }
    throw err;
  }

  const periodEnd = new Date(balance.current_period_end).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    content: [
      {
        type: "text" as const,
        text: [
          `Credits remaining: ${balance.credits_remaining}`,
          `Plan: ${balance.plan_id}`,
          `Status: ${balance.status}`,
          `Current period ends: ${periodEnd}`,
        ].join("\n"),
      },
    ],
  };
}
