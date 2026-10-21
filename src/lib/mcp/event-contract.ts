import { z } from "zod";

export const EVENT_NAME = "budget.threshold_crossed";
export const eventArguments = z.strictObject({ categoryId: z.uuid().optional() });
