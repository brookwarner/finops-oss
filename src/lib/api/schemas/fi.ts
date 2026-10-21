import { z } from "zod";

/** GET /api/fi/repayment query params. Both optional — when omitted,
 *  extraPerMonth defaults to this cycle's planned spare. */
export const fiRepaymentQuerySchema = z.object({
  extraPerMonth: z.coerce.number().min(0).optional(),
  lumpSum: z.coerce.number().min(0).optional(),
});
