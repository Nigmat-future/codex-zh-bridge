import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteRequest } from "../src/rewrite.js";

function makeCache() {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => m.set(k, v),
    _map: m,
  };
}

test("rewriteRequest translates user text, maps assistant text via cache only", async () => {
  const calls = [];
  const translate = async (t, target) => {
    calls.push(t);
    return `EN(${t})`;
  };
  const cache = makeCache();
  cache.set("显示过的中文", "English shown earlier");

  const body = {
    instructions: "You are Codex. 保持系统提示不变",
    tools: [{ type: "function" }],
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "你好世界" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "already english" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "!en 直接发送原文" }] },
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "显示过的中文" },
          { type: "output_text", text: "未缓存的中文回复" },
        ],
      },
      { type: "function_call", name: "f", arguments: "{\"a\":\"中文\"}" },
      { type: "function_call_output", output: "中文输出" },
      { type: "reasoning", summary: [{ text: "中文推理" }] },
    ],
  };

  const out = await rewriteRequest(body, { translate, cache });

  assert.equal(out.input[0].content[0].text, "EN(你好世界)");
  assert.equal(out.input[1].content[0].text, "already english");
  assert.equal(out.input[2].content[0].text, "直接发送原文");
  assert.equal(cache.get("!en 直接发送原文"), "直接发送原文");
  assert.equal(out.input[3].content[0].text, "English shown earlier");
  assert.equal(out.input[3].content[1].text, "未缓存的中文回复"); // lookup only
  assert.equal(out.input[4].arguments, "{\"a\":\"中文\"}");
  assert.equal(out.input[5].output, "中文输出");
  assert.equal(out.input[6].summary[0].text, "中文推理");
  assert.equal(out.instructions, body.instructions);
  assert.deepEqual(out.tools, body.tools);
  assert.deepEqual(calls, ["你好世界"]);

  // second call hits cache, no new translate calls
  const out2 = await rewriteRequest(body, { translate, cache });
  assert.equal(out2.input[0].content[0].text, "EN(你好世界)");
  assert.equal(calls.length, 1);
});

test("string input treated as one user text", async () => {
  const translate = async (t) => `EN(${t})`;
  const out = await rewriteRequest(
    { input: "你好" },
    { translate, cache: makeCache() }
  );
  assert.equal(out.input[0].content[0].text, "EN(你好)");
});

test("duplicate Chinese texts in one request translate once", async () => {
  let n = 0;
  const translate = async (t) => {
    n++;
    return `EN(${t})`;
  };
  const body = {
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "重复" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "重复" }] },
    ],
  };
  const out = await rewriteRequest(body, { translate, cache: makeCache() });
  assert.equal(n, 1);
  assert.equal(out.input[0].content[0].text, "EN(重复)");
  assert.equal(out.input[1].content[0].text, "EN(重复)");
});
