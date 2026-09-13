import os from "node:os";
import path from "node:path";

export const CHATGPT_UPSTREAM = "https://chatgpt.com/backend-api/codex";
export const API_UPSTREAM = "https://api.openai.com/v1";

export function loadConfig(env = process.env) {
  const upstream = env.BRIDGE_UPSTREAM || null;
  const cacheFile =
    env.BRIDGE_CACHE_FILE ||
    path.join(os.homedir(), ".codex-zh-bridge", "cache.json");

  return {
    port: Number(env.BRIDGE_PORT || 8787),
    host: "127.0.0.1",
    upstream,
    resolveUpstream(req) {
      if (upstream) return upstream;
      return req.headers["chatgpt-account-id"] ? CHATGPT_UPSTREAM : API_UPSTREAM;
    },
    translator: {
      baseUrl: env.BRIDGE_TRANSLATOR_BASE_URL || "https://api.openai.com/v1",
      apiKey: env.BRIDGE_TRANSLATOR_API_KEY || env.OPENAI_API_KEY || "",
      model: env.BRIDGE_TRANSLATOR_MODEL || "gpt-4o-mini",
    },
    cacheFile,
    disabled: env.BRIDGE_DISABLE === "1",
    logLevel: env.BRIDGE_LOG || "info",
    fakeTranslator: env.BRIDGE_TRANSLATOR_FAKE === "1",
  };
}
