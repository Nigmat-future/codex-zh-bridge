#!/usr/bin/env node
import { loadConfig } from "../src/config.js";
import { createTranslator } from "../src/translator.js";
import { createCache } from "../src/cache.js";
import { createServer } from "../src/server.js";

const config = loadConfig();

const log = {
  info: (...a) => console.log("[bridge]", ...a),
  warn: (...a) => console.warn("[bridge:warn]", ...a),
  debug:
    config.logLevel === "debug"
      ? (...a) => console.log("[bridge:debug]", ...a)
      : () => {},
};

const translate = config.fakeTranslator
  ? async (t, target) => (target === "en" ? `[EN] ${t}` : `[ZH] ${t}`)
  : createTranslator({ ...config.translator, log });

if (config.fakeTranslator) {
  log.warn("BRIDGE_TRANSLATOR_FAKE=1 — using a fake translator, output will be tagged, not translated");
}

const cache = createCache(config.cacheFile);
const server = createServer({
  translate,
  cache,
  resolveUpstream: config.resolveUpstream,
  log,
  disabled: config.disabled,
});

server.listen(config.port, config.host, () => {
  log.info(`listening on http://${config.host}:${config.port}`);
  log.info(`upstream: ${config.upstream ?? "auto (chatgpt-account-id header → ChatGPT backend, else api.openai.com)"}`);
  log.info(`translator model: ${config.fakeTranslator ? "(fake)" : config.translator.model}`);
  log.info(`cache file: ${config.cacheFile}`);
  if (config.disabled) log.info("BRIDGE_DISABLE=1 — passthrough mode");
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await cache.flush().catch(() => {});
    process.exit(0);
  });
}
