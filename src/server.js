import http from "node:http";
import { rewriteRequest } from "./rewrite.js";
import { createSseRewriter, rewriteJsonResponse } from "./sse.js";

const HOP_BY_HOP_REQUEST = new Set([
  "host",
  "content-length",
  "connection",
  "accept-encoding",
]);
const HOP_BY_HOP_RESPONSE = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
]);

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export function createServer({
  translate,
  cache,
  resolveUpstream,
  log = console,
  fetchImpl = fetch,
  disabled = false,
}) {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.warn?.(`request handler error: ${err.message}`);
      res.destroy();
    });
  });

  async function handle(req, res) {
    let done = false;
    const markDone = () => {
      done = true;
    };
    res.on("finish", markDone);

    const isResponses = req.method === "POST" && req.url?.split("?")[0].endsWith("/responses");
    const upstreamBase = resolveUpstream(req);
    const pathNoV1 = (req.url || "/").replace(/^\/v1(?=\/|$)/, "");
    const target = `${upstreamBase}${pathNoV1}`;
    log.debug?.(`${req.method} ${req.url} -> ${target}; headers: ${Object.keys(req.headers).join(",")}`);

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP_REQUEST.has(k)) headers[k] = v;
    }
    headers["accept-encoding"] = "identity";

    const ctrl = new AbortController();
    res.on("close", () => {
      if (!done) ctrl.abort();
    });

    let bodyBuf = await readBody(req);
    let sendBody = bodyBuf;

    if (isResponses && !disabled) {
      try {
        const parsed = JSON.parse(bodyBuf.toString("utf8"));
        sendBody = Buffer.from(JSON.stringify(await rewriteRequest(parsed, { translate, cache, log })));
        log.debug?.(
          `rewrite: input items rewritten, ${bodyBuf.length} -> ${sendBody.length} bytes`
        );
      } catch (err) {
        log.warn?.(`request rewrite failed, passing through: ${err.message}`);
      }
    }

    let upstreamRes;
    try {
      upstreamRes = await fetchImpl(target, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : sendBody,
        signal: ctrl.signal,
      });
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: err.message } }));
      return;
    }

    const resHeaders = {};
    for (const [k, v] of upstreamRes.headers.entries()) {
      if (!HOP_BY_HOP_RESPONSE.has(k)) resHeaders[k] = v;
    }

    const contentType = upstreamRes.headers.get("content-type") || "";
    log.debug?.(`upstream ${upstreamRes.status} content-type: ${contentType}`);
    const isJson = contentType.includes("application/json");
    // Some upstreams stream SSE without a content-type header; treat a
    // successful non-JSON body on /responses as an event stream. Error
    // bodies (text/plain, HTML) fall through to plain passthrough.
    const isSse = contentType.includes("text/event-stream") || (!isJson && upstreamRes.ok);

    if (isResponses && !disabled && upstreamRes.body) {
      if (isSse) {
        resHeaders["content-type"] = "text/event-stream";
        res.writeHead(upstreamRes.status, resHeaders);
        const rewriter = createSseRewriter({ translate, cache });
        try {
          for await (const chunk of upstreamRes.body) {
            const out = await rewriter.write(chunk);
            if (out) res.write(out);
          }
          const tail = await rewriter.end();
          if (tail) res.write(tail);
        } catch (err) {
          if (err?.name !== "AbortError") {
            log.warn?.(`SSE rewrite failed mid-stream: ${err.message}`);
          }
        }
        res.end();
        return;
      }
      // JSON body: buffer, rewrite, send
      const buf = Buffer.from(await upstreamRes.arrayBuffer());
      try {
        const json = JSON.parse(buf.toString("utf8"));
        const rewritten = await rewriteJsonResponse(json, { translate, cache });
        const out = Buffer.from(JSON.stringify(rewritten));
        resHeaders["content-length"] = String(out.length);
        res.writeHead(upstreamRes.status, resHeaders);
        res.end(out);
      } catch {
        resHeaders["content-length"] = String(buf.length);
        res.writeHead(upstreamRes.status, resHeaders);
        res.end(buf);
      }
      return;
    }

    res.writeHead(upstreamRes.status, resHeaders);
    if (!upstreamRes.body) {
      res.end();
      return;
    }
    for await (const chunk of upstreamRes.body) {
      res.write(chunk);
    }
    res.end();
  }
}
