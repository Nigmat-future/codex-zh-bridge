import { hasCJK } from "./protect.js";

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

export async function rewriteRequest(body, { translate, cache, log }) {
  if (!body || typeof body !== "object") return body;
  const out = clone(body);

  const pending = new Map(); // text -> Promise<string>

  const toModelText = (text) => {
    if (typeof text !== "string") return Promise.resolve(text);
    const hit = cache.get(text);
    if (hit !== undefined) return Promise.resolve(hit);

    const trimmed = text.trim();
    for (const prefix of ["!en ", "！en "]) {
      if (trimmed.startsWith(prefix)) {
        const stripped = trimmed.slice(prefix.length);
        cache.set(text, stripped);
        return Promise.resolve(stripped);
      }
    }

    if (!hasCJK(text)) return Promise.resolve(text);

    if (!pending.has(text)) {
      pending.set(
        text,
        translate(text, "en").then((translated) => {
          if (typeof translated === "string" && translated !== text) {
            cache.set(text, translated);
            return translated;
          }
          return text;
        })
      );
    }
    return pending.get(text);
  };

  let items;
  if (Array.isArray(out.input)) {
    items = out.input;
  } else if (typeof out.input === "string") {
    items = [{ type: "message", role: "user", content: [{ type: "input_text", text: out.input }] }];
    out.input = items;
  } else {
    return out;
  }

  const jobs = [];
  let assistantParts = 0;
  let assistantReplaced = 0;
  let userTexts = 0;
  const userTextLens = [];
  for (const item of items) {
    if (item?.type !== "message") continue;
    if (item.role === "user") {
      for (const part of item.content ?? []) {
        if (part?.type === "input_text" && typeof part.text === "string") {
          userTexts++;
          userTextLens.push(part.text.length);
          jobs.push(toModelText(part.text).then((t) => (part.text = t)));
        }
      }
    } else if (item.role === "assistant") {
      for (const part of item.content ?? []) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          assistantParts++;
          const hit = cache.get(part.text);
          if (hit !== undefined) {
            assistantReplaced++;
            part.text = hit;
          } else {
            log?.debug?.(`assistant part missed cache: len=${part.text.length}`);
          }
        }
      }
    }
  }
  await Promise.all(jobs);
  log?.debug?.(
    `assistant history: ${assistantParts} parts, ${assistantReplaced} replaced from cache; user texts: ${userTexts} (len ${userTextLens.join("/")}); instructions len=${out.instructions?.length ?? 0}`
  );
  return out;
}
