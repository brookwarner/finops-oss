import { z } from "zod";
import { agentReportInputSchema } from "@/lib/agent-report/build";

/** POST /api/agent-report body — single source of truth is agentReportInputSchema in build.ts */
export const agentReportBodySchema = agentReportInputSchema;

export type AgentReportInput = z.infer<typeof agentReportBodySchema>;
