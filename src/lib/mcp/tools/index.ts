import { defineTool, householdId, type ToolDef } from "./types";
import { budgetTools } from "./budgets";
import { transactionTools } from "./transactions";
import { networthTools } from "./networth";
import { mortgageTools } from "./mortgage";
import { subscriptionTools } from "./subscriptions";
import { fiTools } from "./fi";
import { bufferTools } from "./buffer";
import { cashflowTools } from "./cashflow";
import { agentReportTools } from "./agent-report";
import { assetTools } from "./assets";

const pingTools: ToolDef[] = [
  defineTool("ping", "Health check", {}, async (_args, extra) => {
    const hid = householdId(extra) ?? "unknown";
    return { content: [{ type: "text", text: `ok household=${hid}` }] };
  }),
];

/** Every MCP tool, in registration order. The route registers these via a loop
 * and wraps each handler with `wrapTool` for consistent error handling. */
export const allTools: ToolDef[] = [
  ...pingTools,
  ...budgetTools,
  ...transactionTools,
  ...networthTools,
  ...mortgageTools,
  ...subscriptionTools,
  ...fiTools,
  ...bufferTools,
  ...cashflowTools,
  ...agentReportTools,
  ...assetTools,
];

export { wrapTool } from "./types";
export type { ToolDef } from "./types";
