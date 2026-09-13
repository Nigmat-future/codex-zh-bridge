import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/server.js";

function makeCache() {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), _map: m };
}

const translate = async (t, target) => (target === "en" ? `EN(${t})` : `ZH(${t})`);
const silentLog = { debug: () => {}, warn: () => {}, info: () => {} };

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function ev(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

test("bridge rewrites request upstream and SSE response downstream", async () => {
  let received = null;
  const upstream = http.createServer((req, res) => {
    if (req.url === "/models" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: ["m1"] }));
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received = JSON.parse(Buffer.concat(chunks).toString());
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(ev("response.created", { response: { id: "r" } }));
      res.write(ev("response.output_text.delta", { item_id: "m1", delta: "Hi " }));
      res.write(ev("response.output_text.done", {
        item_id: "m1", output_index: 0, content_index: 0, sequence_number: 2, text: "Hi there",
      }));
      res.end(ev("response.completed", {
        response: { output: [{ type: "message", id: "m1", content: [{ type: "output_text", text: "Hi there" }] }] },
      }));
    });
  });
  const upPort = await listen(upstream);

  const cache = makeCache();
  cache.set("之前显示的中文", "Earlier English reply");
  const bridge = createServer({
    translate,
    cache,
    resolveUpstream: () => `http://127.0.0.1:${upPort}`,
    log: silentLog,
  });
  const brPort = await listen(bridge);

  try {
    const resp = await fetch(`http://127.0.0.1:${brPort}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "m",
        stream: true,
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "你好世界" }] },
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "之前显示的中文" }] },
        ],
      }),
    });
    const text = await resp.text();

    // upstream saw English only
    const userText = received.input[0].content[0].text;
    const asstText = received.input[1].content[0].text;
    assert.equal(userText, "EN(你好世界)");
    assert.equal(asstText, "Earlier English reply");

    // client received Chinese
    assert.ok(text.includes("ZH(Hi there)"));
    assert.ok(!text.includes('"delta":"Hi '));

    // passthrough
    const models = await fetch(`http://127.0.0.1:${brPort}/v1/models`);
    assert.deepEqual(await models.json(), { data: ["m1"] });
  } finally {
    bridge.close();
    upstream.close();
  }
});

test("non-2xx non-JSON error bodies pass through untouched", async () => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(401, { "content-type": "text/plain" });
    res.end("unauthorized");
  });
  const upPort = await listen(upstream);
  const bridge = createServer({
    translate,
    cache: makeCache(),
    resolveUpstream: () => `http://127.0.0.1:${upPort}`,
    log: silentLog,
  });
  const brPort = await listen(bridge);
  try {
    const resp = await fetch(`http://127.0.0.1:${brPort}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m", input: [] }),
    });
    assert.equal(resp.status, 401);
    assert.equal(resp.headers.get("content-type"), "text/plain");
    assert.equal(await resp.text(), "unauthorized");
  } finally {
    bridge.close();
    upstream.close();
  }
});
