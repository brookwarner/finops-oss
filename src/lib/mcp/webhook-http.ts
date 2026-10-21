import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

/** Reject every non-public range, including IPv4-mapped IPv6. */
export function publicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === "unicast"; }
  catch { return false; }
}

export function callbackUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    throw new Error("Callback must be an HTTPS URL on port 443 without credentials or fragment");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !publicAddress(host)) throw new Error("Callback address must be public");
  return url;
}

/** Resolve on every request, then pin the socket to the checked IP. No redirects. */
export async function webhookPost(raw: string, body: string, headers: Record<string, string>) {
  const url = callbackUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error("Callback address must be public");
  const target = addresses[0];
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(url, {
      method: "POST", agent: false, family: target.family, signal: AbortSignal.timeout(10_000),
      headers: { ...headers, "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
      // Preserve the URL host for TLS SNI/certificate checks; pin only DNS resolution.
      lookup: (_hostname, _options, done) => done(null, target.address, target.family),
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024) { res.destroy(); req.destroy(new Error("Callback response too large")); }
        else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
