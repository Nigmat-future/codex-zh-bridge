function parseBlock(block) {
  let event = null;
  const dataLines = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: dataLines.join("\n") };
}

function serialize(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function rewriteMessageItem(item, zhById, translateNow) {
  // returns array of jobs mutating part.text
  const jobs = [];
  if (item?.type !== "message" || !Array.isArray(item.content)) return jobs;
  for (const part of item.content) {
    if (part?.type !== "output_text" || typeof part.text !== "string") continue;
    const remembered = zhById.get(item.id);
    if (remembered !== undefined) {
      part.text = remembered;
    } else {
      jobs.push(
        translateNow(part.text, item.id).then((zh) => {
          part.text = zh;
        })
      );
    }
  }
  return jobs;
}

export function createSseRewriter({ translate, cache }) {
  const decoder = new TextDecoder();
  let buffer = "";
  const deltaById = new Map();
  const zhById = new Map();

  const translateToZh = async (text, itemId) => {
    const zh = await translate(text, "zh");
    const result = typeof zh === "string" ? zh : text;
    // Always record the map, even when result === text (model already
    // answered in Chinese): the displayed text then maps to itself, which
    // is still the correct model-side text for history lookups.
    cache.set(result, text);
    if (itemId !== undefined) zhById.set(itemId, result);
    return result;
  };

  async function processBlock(block) {
    const { event, data } = parseBlock(block);
    if (!event || data === "") return block; // comment / keep-alive block

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return block;
    }

    switch (event) {
      case "response.output_text.delta": {
        const id = parsed.item_id;
        if (typeof parsed.delta === "string" && id !== undefined) {
          deltaById.set(id, (deltaById.get(id) ?? "") + parsed.delta);
        }
        return ""; // swallowed
      }

      case "response.output_text.done": {
        const id = parsed.item_id;
        const text = typeof parsed.text === "string" ? parsed.text : deltaById.get(id) ?? "";
        const zh = await translateToZh(text, id);
        const delta = { ...parsed, type: "response.output_text.delta", delta: zh };
        delete delta.text;
        const done = { ...parsed, text: zh };
        return (
          serialize("response.output_text.delta", delta) +
          serialize("response.output_text.done", done)
        );
      }

      case "response.output_item.done": {
        if (parsed.item?.type === "message") {
          const jobs = rewriteMessageItem(parsed.item, zhById, translateToZh);
          await Promise.all(jobs);
          return serialize(event, parsed);
        }
        return block;
      }

      case "response.completed":
      case "response.incomplete":
      case "response.failed": {
        const output = parsed.response?.output;
        if (Array.isArray(output)) {
          const jobs = [];
          for (const item of output) {
            jobs.push(...rewriteMessageItem(item, zhById, translateToZh));
          }
          await Promise.all(jobs);
          return serialize(event, parsed);
        }
        return block;
      }

      default:
        return block;
    }
  }

  async function write(chunk) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const out = [];
    let idx;
    while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const match = buffer.slice(idx).match(/^\r?\n\r?\n/)[0];
      const block = buffer.slice(0, idx + match.length);
      buffer = buffer.slice(idx + match.length);
      out.push(await processBlock(block));
    }
    return out.join("");
  }

  async function end() {
    buffer += decoder.decode();
    if (buffer === "") return "";
    const block = buffer;
    buffer = "";
    return processBlock(block);
  }

  return { write, end };
}

// Non-streaming JSON body rewriting (stream:false responses and error JSONs).
export async function rewriteJsonResponse(json, { translate, cache }) {
  if (!json || !Array.isArray(json.output)) return json;
  const jobs = [];
  for (const item of json.output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type !== "output_text" || typeof part.text !== "string") continue;
      jobs.push(
        (async () => {
          const zh = await translate(part.text, "zh");
          const result = typeof zh === "string" ? zh : part.text;
          cache.set(result, part.text);
          part.text = result;
        })()
      );
    }
  }
  await Promise.all(jobs);
  return json;
}
