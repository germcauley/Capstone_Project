import { createServer, type IncomingMessage } from "node:http";
import { pickProvider } from "./providers.js";

const PORT = Number(process.env.PORT || 8787);
const MAX_BODY = 200_000;
const provider = pickProvider();

/** Only the local dev server (or direct localhost calls) may use this: it spends the user's plan. */
export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const h = new URL(origin).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!originAllowed(req.headers.origin)) return send(403, { error: "origin not allowed" });

  if (req.method === "GET" && req.url === "/api/health") {
    return send(200, { ok: true, provider: provider.id, model: provider.model });
  }

  if (req.method === "POST" && req.url === "/api/generate") {
    try {
      const { system, prompt } = JSON.parse(await readBody(req)) as { system?: unknown; prompt?: unknown };
      if (typeof system !== "string" || typeof prompt !== "string" || !prompt) {
        return send(400, { error: "system and prompt strings required" });
      }
      const ac = new AbortController();
      res.on("close", () => ac.abort());
      const text = await provider.complete(system, prompt, ac.signal);
      return send(200, { text, provider: provider.id });
    } catch (e) {
      return send(502, { error: (e as Error).message });
    }
  }
  send(404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`composer proxy on http://127.0.0.1:${PORT} using ${provider.id} (${provider.model})`);
});
