import type { BudgetComputeResult, BudgetStatusRow } from "@/lib/budgets/compute";
import type { Position } from "@/lib/budgets/position";
import type { NetWorthResult } from "@/lib/networth/compute";
import type { FIResult } from "@/lib/fi/compute";
import type { ForecastResult } from "@/lib/forecast/compute";
import type { DailyBurnResult } from "@/lib/spend/daily-burn";
import type { ScenarioResult } from "@/lib/mortgage/scenario";
import type { RepaymentFIResult } from "@/lib/fi/repayment";
import type { EmergencyFundState } from "@/lib/buffer/compute";
import type { AllocationResult } from "@/lib/allocation/compute";
import type { AccountHoldings, PortfolioSummary } from "@/lib/holdings/group";
import type { CashflowResult } from "@/lib/cashflow/engine";
import type { IncomeHistory } from "@/lib/income/history";
import type { CategoryHistory, CycleHistory } from "@/lib/budgets/snapshot";
import type { PresentResult } from "@/lib/subscriptions/present";
import type { ManualAsset } from "@/lib/assets/store";
import type { CategoriseResult } from "@/lib/transactions/write";

/**
 * GET /api/budgets (no `category` param).
 * Returns a subset of BudgetComputeResult: period, flex, inbox, position, and
 * the (optionally group-filtered) budget rows. Does NOT include shadowCommitted,
 * unallocatedPending, or reserveBuffer.
 */
export interface BudgetsResponse {
  period: BudgetComputeResult["period"];
  flex: BudgetComputeResult["flex"];
  inbox: BudgetComputeResult["inbox"];
  position: Position;
  budgets: BudgetStatusRow[];
}

/** GET /api/budgets?category=… */
export interface BudgetLookupResponse {
  found: boolean;
  category: string;
  period: BudgetComputeResult["period"];
  budget: BudgetStatusRow | null;
}

/** GET /api/net-worth */
export interface NetWorthResponse extends NetWorthResult {}

/** GET /api/fi */
export interface FIResponse extends FIResult {}

/** GET /api/forecast */
export interface ForecastResponse extends ForecastResult {}

/** GET /api/spend/daily-burn */
export interface DailyBurnResponse extends DailyBurnResult {}

/** GET /api/mortgage */
export interface MortgageResponse extends ScenarioResult {}

/**
 * PATCH /api/budgets/target (success branch).
 * The route returns `{ category, ...result }` where result is
 * `{ ok: true; previousTarget: number; newTarget: number }`.
 */
export interface SetBudgetTargetResponse {
  category: string;
  ok: boolean;
  previousTarget: number;
  newTarget: number;
}

/** Canonical error body shared by all routes */
export interface ApiError {
  error: string;
  issues?: unknown;
}

/** GET /api/allocation — surplus-allocation recommendation */
export interface AllocationResponse extends AllocationResult {}

/** GET /api/investments — investment holdings grouped by account + portfolio roll-up */
export interface InvestmentsResponse {
  accounts: AccountHoldings[];
  portfolio: PortfolioSummary;
}

/** PATCH /api/investments/inception — set account's manual investing-since date */
export interface InvestmentInceptionResponse {
  ok: boolean;
  account: string;
  date: string | null;
}

/** GET /api/cashflow — unified cashflow game-plan */
export interface CashflowResponse extends CashflowResult {}

/** GET /api/income/history — per-cycle plan-vs-actual income */
export interface IncomeHistoryResponse extends IncomeHistory {}

/**
 * GET /api/budgets/history — budget snapshot history.
 * With `category` param: CategoryHistory. Without: { cycles: CycleHistory[] }.
 */
export type BudgetHistoryResponse = CategoryHistory | { cycles: CycleHistory[] };

/** GET /api/subscriptions — detected recurring charges */
export interface SubscriptionsResponse extends PresentResult {}

/** GET /api/review — transactions awaiting categorisation review */
export interface ReviewResponse {
  pending: number;
  transactions: {
    id: string;
    occurred_at: string;
    amount: number;
    merchant: string | null;
    description: string | null;
    account: string | null;
  }[];
}

/** GET /api/assets — list manual assets */
export interface AssetsListResponse {
  assets: ManualAsset[];
}

/** POST /api/assets — create or update a manual asset */
export interface AssetsUpsertResponse {
  asset: ManualAsset;
}

/** DELETE /api/assets — remove a manual asset */
export interface AssetsDeleteResponse {
  ok: boolean;
}

/** PATCH /api/transactions/categorise — assign category to transactions */
export interface CategoriseTransactionsResponse extends CategoriseResult {
  /** Resolved category name, present when the caller used the name-based path. */
  category?: string;
}

/** POST /api/transactions/apply-similar — bulk-categorise by merchant */
export interface ApplySimilarResponse {
  updated: number;
}

/** POST /api/transactions/accept-suggestions — accept pending review suggestions */
export interface AcceptSuggestionsResponse {
  accepted: number;
}

/** POST /api/agent-report — persist + deliver monthly review report */
export interface AgentReportResponse {
  delivered: boolean;
  error?: string | null;
}

/** GET /api/fi/repayment — mortgage-vs-invest FI head-to-head */
export interface RepaymentFIResponse extends RepaymentFIResult {}

/** GET /api/buffer — emergency fund (cash buffer) status */
export interface EmergencyFundResponse extends EmergencyFundState {}
