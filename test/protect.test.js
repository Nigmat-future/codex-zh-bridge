import { test } from "node:test";
import assert from "node:assert/strict";
import { mask, hasCJK, PlaceholderLostError } from "../src/protect.js";

function reversingTranslate(masked) {
  // Reverse segments outside placeholders, keep placeholders in place.
  return masked.replace(/⟦\d+⟧|[^⟦⟧]+/g, (m) =>
    m.startsWith("⟦") ? m : m.split("").reverse().join("")
  );
}

test("mask/restore round-trip protects code, URLs, paths, tags", () => {
  const text = [
    "请帮我修改 src/foo.js 和 D:\\work\\proj\\app.js",
    "```js",
    "const x = require('./run.sh');",
    "```",
    "内联代码 `npm test` 别动",
    "参考 https://example.com/a?b=c",
    "路径 ~/.codex/config.toml 和 ../lib/util.py",
    "标签 <thinking>别翻译</thinking> 和 ~~~\nfenced\n~~~",
  ].join("\n");

  const { masked, restore } = mask(text);
  assert.ok(masked.includes("⟦0⟧"));
  const translated = reversingTranslate(masked);
  const restored = restore(translated);

  for (const frag of [
    "```js\nconst x = require('./run.sh');\n```",
    "`npm test`",
    "https://example.com/a?b=c",
    "D:\\work\\proj\\app.js",
    "src/foo.js",
    "~/.codex/config.toml",
    "../lib/util.py",
    "<thinking>",
    "</thinking>",
  ]) {
    assert.ok(restored.includes(frag), `missing: ${frag}`);
  }
});

test("restore throws PlaceholderLostError when a placeholder is dropped", () => {
  const { restore } = mask("运行 `make build` 然后提交");
  assert.throws(() => restore("then commit"), PlaceholderLostError);
});

test("restore returns original when translation keeps placeholders", () => {
  const { masked, restore } = mask("修复 `bug` 吧");
  const restored = restore("fix ⟦0⟧ please");
  assert.equal(restored, "fix `bug` please");
});

test("hasCJK", () => {
  assert.ok(hasCJK("你好"));
  assert.ok(hasCJK("mixed 中文 text"));
  assert.ok(hasCJK("。！ punctuation"));
  assert.ok(!hasCJK("hello world"));
  assert.ok(!hasCJK(""));
});
