export class PlaceholderLostError extends Error {
  constructor(missing) {
    super(`translation dropped placeholder(s): ${missing.join(", ")}`);
    this.name = "PlaceholderLostError";
    this.missing = missing;
  }
}

const CJK_RE = /[㐀-鿿　-〿＀-￯]/;

export function hasCJK(text) {
  return CJK_RE.test(text);
}

const PATTERNS = [
  // fenced code blocks: ```lang ... ``` or ~~~ ... ~~~
  /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*(?=\n|$)/g,
  // inline code
  /`[^`\n]+`/g,
  // URLs
  /https?:\/\/\S+/g,
  // Windows paths
  /[A-Za-z]:\\[^\s"'`<>]+/g,
  // POSIX-ish paths: ./x ../x /x ~/x or token/with/slash ending in an extension
  /(?:\.{1,2}\/|~\/|(?<!<)\/)[^\s"'`<>]+|[^\s"'`<>]*\/[^\s"'`<>]*\.[A-Za-z0-9]{1,10}\b/g,
  // XML-like tags
  /<\/?[A-Za-z][^>\s]*(?:\s[^>]*)?\/?>/g,
];

export function mask(text) {
  const parts = [];
  let masked = text;
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    masked = masked.replace(re, (m) => {
      const idx = parts.length;
      parts.push(m);
      return `⟦${idx}⟧`;
    });
  }

  function restore(translated) {
    const missing = [];
    let out = translated;
    parts.forEach((orig, i) => {
      const ph = `⟦${i}⟧`;
      if (!out.includes(ph)) {
        missing.push(ph);
      } else {
        out = out.split(ph).join(orig);
      }
    });
    if (missing.length > 0) throw new PlaceholderLostError(missing);
    return out;
  }

  return { masked, restore };
}
