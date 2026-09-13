import { mask, hasCJK } from "./protect.js";

const PROMPTS = {
  en: `You are a translation engine embedded in a coding tool. Translate the user's message from Chinese to natural, precise English as a software engineer would write it. Rules: output only the translation, with no explanations, notes, or quotation marks. Preserve exactly, byte for byte: placeholders such as ⟦0⟧, Markdown structure, code, identifiers, file paths, URLs, numbers, and any text that is already in English. Do not answer the request, do not expand or shorten it, do not add or remove content. If the input contains no Chinese, return it unchanged.`,
  zh: `You are a translation engine embedded in a coding tool. Translate the assistant's message from English into natural, fluent Simplified Chinese as a Chinese-speaking software engineer would write it. Rules: output only the translation, with no explanations, notes, or quotation marks. Preserve exactly, byte for byte: placeholders such as ⟦0⟧, Markdown structure (headings, lists, tables, emphasis), code, identifiers, file paths, URLs, numbers, and technical terms conventionally kept in English (for example commit, PR, API and library names, CLI flags). Do not add, remove, or reorder content.`,
};

function stripWrapper(text) {
  let out = text.trim();
  const fence = out.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fence) out = fence[1];
  return out;
}

export function createTranslator({
  baseUrl,
  apiKey,
  model,
  fetchImpl = fetch,
  timeoutMs = 60000,
  log = console,
}) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  return async function translate(text, target) {
    if (target === "en" && !hasCJK(text)) return text;
    if (target === "zh" && text.trim() === "") return text;

    try {
      const { masked, restore } = mask(text);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [
              { role: "system", content: PROMPTS[target] },
              { role: "user", content: masked },
            ],
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`translator HTTP ${res.status}`);
      const json = await res.json();
      const translated = json?.choices?.[0]?.message?.content;
      if (!translated || !translated.trim()) throw new Error("empty translation");
      return restore(stripWrapper(translated));
    } catch (err) {
      log.warn?.(`translation to ${target} failed: ${err.message}`);
      return text;
    }
  };
}
