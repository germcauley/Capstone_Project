import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Provider {
  id: "claude-cli" | "anthropic-api";
  model: string;
  complete(system: string, prompt: string, signal: AbortSignal): Promise<string>;
}

const TIMEOUT_MS = 240_000;

/**
 * Dev provider: runs the local `claude` CLI headless on the user's own plan login.
 * Hooks, settings, tools and session files are all switched off so the reply is plain model text.
 */
export function claudeCli(model = process.env.COMPOSER_MODEL || "sonnet"): Provider {
  return {
    id: "claude-cli",
    model,
    complete(system, prompt, signal) {
      return new Promise((resolve, reject) => {
        const cwd = mkdtempSync(join(tmpdir(), "composer-claude-"));
        const child = spawn(
          "claude",
          [
            "-p",
            "--output-format", "json",
            "--no-session-persistence",
            "--tools", "",
            "--setting-sources", "",
            "--model", model,
            "--system-prompt", system,
          ],
          { cwd, stdio: ["pipe", "pipe", "pipe"], signal },
        );
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", (e) => reject(new Error(`could not run claude CLI: ${e.message}`)));
        child.on("close", (code) => {
          if (code !== 0) return reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 300)}`));
          try {
            const json = JSON.parse(out) as { is_error?: boolean; result?: string };
            if (json.is_error || typeof json.result !== "string") throw new Error(json.result || "CLI reported an error");
            resolve(json.result);
          } catch (e) {
            reject(new Error(`bad CLI output: ${(e as Error).message}`));
          }
        });
        child.stdin.end(prompt);
        setTimeout(() => child.kill(), TIMEOUT_MS).unref();
      });
    },
  };
}

/** Production provider: Anthropic Messages API with a key from the environment. */
export function anthropicApi(
  apiKey: string,
  model = process.env.COMPOSER_MODEL || "claude-sonnet-5-5",
): Provider {
  return {
    id: "anthropic-api",
    model,
    async complete(system, prompt, signal) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          system,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = data.content?.find((c) => c.type === "text")?.text;
      if (!text) throw new Error("Anthropic API returned no text");
      return text;
    },
  };
}

export function pickProvider(env = process.env): Provider {
  const want = env.COMPOSER_PROVIDER;
  if (want === "api" || (!want && env.ANTHROPIC_API_KEY)) {
    if (!env.ANTHROPIC_API_KEY) throw new Error("COMPOSER_PROVIDER=api needs ANTHROPIC_API_KEY");
    return anthropicApi(env.ANTHROPIC_API_KEY);
  }
  return claudeCli();
}
