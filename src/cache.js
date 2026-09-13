import fs from "node:fs";
import path from "node:path";

const MAX_ENTRIES = 5000;
const FLUSH_DELAY_MS = 500;

export function createCache(filePath) {
  const map = new Map();

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string") map.set(k, v);
    }
  } catch {
    // missing or corrupt file: start empty
  }

  let timer = null;
  let dirty = false;

  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return;
    dirty = false;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const data = Object.fromEntries(map);
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  }

  return {
    get(clientText) {
      return map.get(clientText);
    },
    set(clientText, modelText) {
      map.delete(clientText);
      map.set(clientText, modelText);
      while (map.size > MAX_ENTRIES) {
        map.delete(map.keys().next().value);
      }
      dirty = true;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          flush().catch(() => {});
        }, FLUSH_DELAY_MS);
        timer.unref?.();
      }
    },
    flush,
  };
}
