import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const mock = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mock.lookup }));
vi.mock("node:https", () => ({ request: mock.request }));
import { webhookPost } from "@/lib/mcp/webhook-http";
beforeEach(() => { vi.resetAllMocks(); });
it("blocks a hostname resolving to any private IP before opening a connection", async () => {
  mock.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  await expect(webhookPost("https://receiver.example/callback", "{}", {})).rejects.toThrow("public");
  expect(mock.request).not.toHaveBeenCalled();
});
it("pins each connection to its validated address and never follows redirects", async () => {
  mock.lookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
    .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
  mock.request.mockImplementation((url, options, onResponse) => {
    expect(url.hostname).toBe("receiver.example"); expect(options.family).toBe(4); expect(options.agent).toBe(false);
    options.lookup("receiver.example", {}, (error: unknown, address: string, family: number) => {
      expect(error).toBeNull(); expect(address).toBe("8.8.8.8"); expect(family).toBe(4);
    });
    const req: any = new EventEmitter();
    req.end = () => {
      const res: any = new EventEmitter(); res.statusCode = 302; onResponse(res);
      res.emit("data", Buffer.from("redirect")); res.emit("end");
    };
    return req;
  });
  expect((await webhookPost("https://receiver.example/callback", "{}", {})).status).toBe(302);
  await expect(webhookPost("https://receiver.example/callback", "{}", {})).rejects.toThrow("public");
  expect(mock.request).toHaveBeenCalledTimes(1);
});
