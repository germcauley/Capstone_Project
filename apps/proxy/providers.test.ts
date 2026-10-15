import { describe, expect, it } from "vitest";
import { pickProvider } from "./providers.js";

describe("pickProvider", () => {
  it("defaults to the Claude CLI when no key is set", () => {
    expect(pickProvider({}).id).toBe("claude-cli");
  });
  it("uses the API when a key is present", () => {
    expect(pickProvider({ ANTHROPIC_API_KEY: "k" }).id).toBe("anthropic-api");
  });
  it("lets COMPOSER_PROVIDER force the CLI even with a key", () => {
    expect(pickProvider({ ANTHROPIC_API_KEY: "k", COMPOSER_PROVIDER: "cli" }).id).toBe("claude-cli");
  });
  it("refuses api mode without a key", () => {
    expect(() => pickProvider({ COMPOSER_PROVIDER: "api" })).toThrow();
  });
});
