import { llmGenerator, type MelodyGenerator } from "@composer/core";

/** Calls the local proxy, which talks to the Claude CLI (dev) or the Anthropic API (prod). */
export const proxyGenerator: MelodyGenerator = llmGenerator("claude-proxy", async (system, prompt) => {
  let res: Response;
  try {
    res = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system, prompt }),
    });
  } catch {
    throw new Error("Can't reach the generator. Start it with `pnpm dev` from the project root.");
  }
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || !body.text) throw new Error(body.error || `Generator failed (${res.status})`);
  return body.text;
});

export async function proxyHealth(): Promise<string | null> {
  try {
    const r = await fetch("/api/health");
    if (!r.ok) return null;
    const j = (await r.json()) as { provider: string; model: string };
    return `${j.provider === "claude-cli" ? "Claude CLI (your plan)" : "Anthropic API"} · ${j.model}`;
  } catch {
    return null;
  }
}
