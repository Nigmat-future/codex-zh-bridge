import { test } from "node:test";
import assert from "node:assert/strict";
import { createSseRewriter, rewriteJsonResponse } from "../src/sse.js";

function makeCache() {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), _map: m };
}

const translate = async (t) => `ZH(${t})`;

function ev(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function script() {
  return [
    ev("response.created", { type: "response.created", response: { id: "r1" } }),
    ev("response.reasoning_summary_text.delta", { type: "x", delta: "thinking..." }),
    ev("response.output_text.delta", { item_id: "m1", output_index: 0, content_index: 0, delta: "Hello, " }),
    ev("response.output_text.delta", { item_id: "m1", output_index: 0, content_index: 0, delta: "this is " }),
    ev("response.output_text.delta", { item_id: "m1", output_index: 0, content_index: 0, delta: "SSE." }),
    ev("response.output_text.done", {
      type: "response.output_text.done",
      item_id: "m1",
      output_index: 0,
      content_index: 0,
      sequence_number: 9,
      text: "Hello, this is SSE.",
    }),
    ev("response.output_item.done", {
      item: {
        type: "message",
        id: "m1",
        role: "assistant",
        content: [{ type: "output_text", text: "Hello, this is SSE." }],
      },
    }),
    ev("response.function_call_arguments.delta", { item_id: "f1", delta: "{\"a\":" }),
    ev("response.output_item.done", {
      item: { type: "function_call", id: "f1", name: "run", arguments: "{\"a\":1}" },
    }),
    ev("response.completed", {
      response: {
        id: "r1",
        output: [
          {
            type: "message",
            id: "m1",
            role: "assistant",
            content: [{ type: "output_text", text: "Hello, this is SSE." }],
          },
          { type: "function_call", id: "f1", arguments: "{\"a\":1}" },
        ],
      },
    }),
  ].join("");
}

function parseEvents(sseText) {
  return sseText
    .split("\n\n")
    .filter((b) => b.trim() !== "")
    .map((block) => {
      let event, data;
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data = line.slice(5).trim();
      }
      return { event, data: data ? JSON.parse(data) : null, raw: block + "\n\n" };
    });
}

for (const splitSize of [7, 40, 100000]) {
  test(`sse rewrite with chunk splits of ${splitSize}`, async () => {
    const cache = makeCache();
    const r = createSseRewriter({ translate, cache });
    const src = script();
    let out = "";
    for (let i = 0; i < src.length; i += splitSize) {
      out += await r.write(src.slice(i, i + splitSize));
    }
    out += await r.end();

    const events = parseEvents(out);
    const deltas = events.filter((e) => e.event === "response.output_text.delta");
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0].data.delta, "ZH(Hello, this is SSE.)");
    assert.equal(deltas[0].data.item_id, "m1");
    assert.equal(deltas[0].data.sequence_number, 9);

    const doneIdx = events.findIndex((e) => e.event === "response.output_text.done");
    assert.ok(doneIdx > events.indexOf(deltas[0]), "synthetic delta precedes done");
    assert.equal(events[doneIdx].data.text, "ZH(Hello, this is SSE.)");

    const itemDone = events.find((e) => e.event === "response.output_item.done" && e.data.item.type === "message");
    assert.equal(itemDone.data.item.content[0].text, "ZH(Hello, this is SSE.)");

    const completed = events.find((e) => e.event === "response.completed");
    assert.equal(completed.data.response.output[0].content[0].text, "ZH(Hello, this is SSE.)");
    assert.equal(completed.data.response.output[1].arguments, "{\"a\":1}");

    const fcItem = events.find((e) => e.event === "response.output_item.done" && e.data.item.type === "function_call");
    assert.equal(fcItem.raw, ev("response.output_item.done", {
      item: { type: "function_call", id: "f1", name: "run", arguments: "{\"a\":1}" },
    }));
    const reasoning = events.find((e) => e.event === "response.reasoning_summary_text.delta");
    assert.equal(reasoning.raw, ev("response.reasoning_summary_text.delta", { type: "x", delta: "thinking..." }));

    // order preserved: response.created first, completed last
    assert.equal(events[0].event, "response.created");
    assert.equal(events.at(-1).event, "response.completed");

    assert.equal(cache.get("ZH(Hello, this is SSE.)"), "Hello, this is SSE.");
  });
}

test("comment and keep-alive blocks pass through", async () => {
  const r = createSseRewriter({ translate, cache: makeCache() });
  const out = await r.write(": ping\n\n" + ev("response.created", { a: 1 }));
  assert.ok(out.startsWith(": ping\n\n"));
});

test("rewriteJsonResponse rewrites message output_text", async () => {
  const cache = makeCache();
  const json = {
    output: [
      { type: "message", id: "m1", content: [{ type: "output_text", text: "Hi there" }] },
      { type: "function_call", arguments: "{}" },
    ],
  };
  const out = await rewriteJsonResponse(json, { translate, cache });
  assert.equal(out.output[0].content[0].text, "ZH(Hi there)");
  assert.equal(cache.get("ZH(Hi there)"), "Hi there");
});
