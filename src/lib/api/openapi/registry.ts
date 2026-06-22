import type { ZodType } from "zod";
import {
  budgetsQuerySchema, setBudgetTargetSchema,
  cashflowQuerySchema, incomeHistoryQuerySchema,
  budgetHistoryQuerySchema, reviewQuerySchema,
  assetsDeleteQuerySchema, assetsUpsertBodySchema,
  categoriseBodySchema, applySimilarBodySchema, acceptSuggestionsBodySchema,
  investmentInceptionBodySchema, agentReportBodySchema,
  fiRepaymentQuerySchema,
} from "@/lib/api/schemas";

export interface RouteDoc {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;            // e.g. "/api/budgets"
  summary: string;
  request?: { query?: ZodType; body?: ZodType; params?: ZodType };
  responseType: string;    // a key in responses.generated.json
  status?: number;         // default 200
}

export const registry: RouteDoc[] = [
  { method: "GET", path: "/api/budgets", summary: "Budget status for a period",
    request: { query: budgetsQuerySchema }, responseType: "BudgetsResponse" },
  { method: "PATCH", path: "/api/budgets/target", summary: "Set a category's monthly target",
    request: { body: setBudgetTargetSchema }, responseType: "SetBudgetTargetResponse" },
  { method: "GET", path: "/api/net-worth", summary: "Assets minus liabilities", responseType: "NetWorthResponse" },
  { method: "GET", path: "/api/fi", summary: "Financial-independence projection", responseType: "FIResponse" },
  { method: "GET", path: "/api/fi/repayment", summary: "Mortgage-vs-invest FI head-to-head",
    request: { query: fiRepaymentQuerySchema }, responseType: "RepaymentFIResponse" },
  { method: "GET", path: "/api/buffer", summary: "Emergency fund (cash buffer) status", responseType: "EmergencyFundResponse" },
  { method: "GET", path: "/api/forecast", summary: "Cashflow forecast", responseType: "ForecastResponse" },
  { method: "GET", path: "/api/spend/daily-burn", summary: "Daily burn rate", responseType: "DailyBurnResponse" },
  { method: "GET", path: "/api/mortgage", summary: "Mortgage P&I lens", responseType: "MortgageResponse" },

  // Investments
  { method: "GET", path: "/api/investments", summary: "Holdings grouped by account with portfolio roll-up",
    responseType: "InvestmentsResponse" },
  { method: "PATCH", path: "/api/investments/inception", summary: "Set account's manual investing-since date",
    request: { body: investmentInceptionBodySchema }, responseType: "InvestmentInceptionResponse" },

  // Allocation
  { method: "GET", path: "/api/allocation", summary: "Surplus-allocation recommendation across ranked rungs",
    responseType: "AllocationResponse" },

  // Cashflow
  { method: "GET", path: "/api/cashflow", summary: "Unified cashflow game-plan with scenario lines",
    request: { query: cashflowQuerySchema }, responseType: "CashflowResponse" },

  // Income history
  { method: "GET", path: "/api/income/history", summary: "Per-cycle plan-vs-actual income by source",
    request: { query: incomeHistoryQuerySchema }, responseType: "IncomeHistoryResponse" },

  // Budget history
  { method: "GET", path: "/api/budgets/history", summary: "Budget snapshot history (per-category series or all cycles)",
    request: { query: budgetHistoryQuerySchema }, responseType: "BudgetHistoryResponse" },

  // Subscriptions
  { method: "GET", path: "/api/subscriptions", summary: "Detected recurring charges with monthly/annual roll-ups",
    responseType: "SubscriptionsResponse" },

  // Review
  { method: "GET", path: "/api/review", summary: "Transactions awaiting categorisation review",
    request: { query: reviewQuerySchema }, responseType: "ReviewResponse" },

  // Assets — three methods
  { method: "GET", path: "/api/assets", summary: "List manual assets (home, receivables, holdings Akahu can't see)",
    responseType: "AssetsListResponse" },
  { method: "POST", path: "/api/assets", summary: "Create or update a manual asset",
    request: { body: assetsUpsertBodySchema }, responseType: "AssetsUpsertResponse" },
  { method: "DELETE", path: "/api/assets", summary: "Remove a manual asset",
    request: { query: assetsDeleteQuerySchema }, responseType: "AssetsDeleteResponse" },

  // Transactions
  { method: "PATCH", path: "/api/transactions/categorise", summary: "Assign a category to one or many transactions",
    request: { body: categoriseBodySchema }, responseType: "CategoriseTransactionsResponse" },
  { method: "POST", path: "/api/transactions/apply-similar", summary: "Bulk-categorise all uncategorised transactions for a merchant",
    request: { body: applySimilarBodySchema }, responseType: "ApplySimilarResponse" },
  { method: "POST", path: "/api/transactions/accept-suggestions", summary: "Accept pending LLM-suggested categorisations",
    request: { body: acceptSuggestionsBodySchema }, responseType: "AcceptSuggestionsResponse" },

  // Agent report
  { method: "POST", path: "/api/agent-report", summary: "Persist and deliver the monthly review agent report",
    request: { body: agentReportBodySchema }, responseType: "AgentReportResponse" },
];

/** Public routes intentionally NOT documented (infra / non-contract). Paths are
 *  route.ts dirs relative to src/app/api, without leading/trailing slash. */
export const OUT_OF_SCOPE: string[] = [
  "mcp", "openapi.json", "telegram/webhook", "oauth/authorize", "oauth/token", "sync",
  "sync-accounts", "accounts/revolving", "accounts/emergency-fund",
  "cron/evaluate-alerts", "cron/nightly", "cron/poll-transactions",
  "cron/refresh-home-value", "cron/snapshot-budgets", "cron/weekly-flex",
];
