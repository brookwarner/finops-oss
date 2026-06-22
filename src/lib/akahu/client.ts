import { AkahuClient } from "akahu";
import { env } from "@/lib/env";

export interface AkahuConfig {
  appToken: string;
  appSecret: string;
}

export function buildAkahuClient(config: AkahuConfig): AkahuClient {
  if (!config.appToken) throw new Error("AKAHU_APP_TOKEN is required");
  if (!config.appSecret) throw new Error("AKAHU_APP_SECRET is required");
  // timeout (ms) is an axios option passed through by the Akahu SDK (see allowedAxiosOptions).
  return new AkahuClient({ appToken: config.appToken, appSecret: config.appSecret, timeout: 30_000 });
}

export function buildAkahuClientFromEnv(): AkahuClient {
  return buildAkahuClient({
    appToken: env.AKAHU_APP_TOKEN,
    appSecret: env.AKAHU_APP_SECRET,
  });
}
