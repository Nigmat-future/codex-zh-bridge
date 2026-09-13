import { test } from "node:test";
import assert from "node:assert/strict";
import { createTranslator } from "../src/translator.js";

const silentLog = { warn: () => {} };

function fakeFetch(result, capture) {
  return async (url, opts) => {
    capture.url = url;
    capture.body = JSON.parse(opts.body);
    if (result instanceof Error) throw result;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: result } }],
      }),
    };
  };
}

test("sends masked text, restores placeholders in reply", async () => {
  const capture = {};
  const translate = createTranslator({
    baseUrl: "https://t.example/v1",
    apiKey: "k",
    model: "m",
    fetchImpl: fakeFetch("fix ⟦0⟧ now", capture),
    log: silentLog,
  });
  const out = await translate("修复 `bug` 吧", "en");
  assert.equal(out, "fix `bug` now");
  assert.equal(capture.url, "https://t.example/v1/chat/completions");
  assert.equal(capture.body.model, "m");
  assert.equal(capture.body.temperature, 0);
  assert.equal(capture.body.messages[0].role, "system");
  assert.match(capture.body.messages[1].content, /⟦0⟧/);
  assert.ok(!capture.body.messages[1].content.includes("`bug`"));
});

test("en target short-circuits when no CJK", async () => {
  let called = false;
  const translate = createTranslator({
    baseUrl: "x",
    apiKey: "k",
    model: "m",
    fetchImpl: async () => {
      called = true;
      throw new Error("should not be called");
    },
    log: silentLog,
  });
  assert.equal(await translate("hello", "en"), "hello");
  assert.equal(called, false);
});

test("fetch error returns original text", async () => {
  const translate = createTranslator({
    baseUrl: "x",
    apiKey: "k",
    model: "m",
    fetchImpl: fakeFetch(new Error("boom"), {}),
    log: silentLog,
  });
  assert.equal(await translate("你好", "en"), "你好");
});

test("dropped placeholder returns original text", async () => {
  const translate = createTranslator({
    baseUrl: "x",
    apiKey: "k",
    model: "m",
    fetchImpl: fakeFetch("fix it now", {}),
    log: silentLog,
  });
  assert.equal(await translate("修复 `bug` 吧", "en"), "修复 `bug` 吧");
});

test("whitespace-only zh text is unchanged", async () => {
  const translate = createTranslator({
    baseUrl: "x",
    apiKey: "k",
    model: "m",
    fetchImpl: async () => {
      throw new Error("nope");
    },
    log: silentLog,
  });
  assert.equal(await translate("   \n", "zh"), "   \n");
});
