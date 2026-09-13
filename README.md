# codex-zh-bridge

一个本地 HTTP 代理，架在 Codex CLI 和 OpenAI Responses API 之间。你在 Codex 里输入中文，代理把你的消息翻译成英文再发给模型；模型输出的英文再被翻译回中文给你看。模型从头到尾只看到英文、只输出英文，而你只看到中文。

需要如实说明的限制：系统提示（system prompt / instructions）、工具调用与工具输出、文件内容、推理摘要（reasoning summaries）**不会被翻译**——只有用户消息和助手的正文输出会经过翻译。另外 v0.1 的流式输出是**按整条消息**翻译的（等模型写完一条再翻），不是逐 token 的。

## 安装

尚未发布到 npm，从源码安装：

```bash
git clone https://github.com/Nigmat-future/codex-zh-bridge
cd codex-zh-bridge
npm i -g .
```

也可以不安装，直接 `node bin/codex-zh-bridge.js` 运行。

## 启动

PowerShell：

```powershell
$env:BRIDGE_TRANSLATOR_BASE_URL="https://api.deepseek.com/v1"
$env:BRIDGE_TRANSLATOR_API_KEY="sk-..."
$env:BRIDGE_TRANSLATOR_MODEL="deepseek-chat"
codex-zh-bridge
```

bash：

```bash
BRIDGE_TRANSLATOR_BASE_URL=https://api.deepseek.com/v1 \
BRIDGE_TRANSLATOR_API_KEY=sk-... \
BRIDGE_TRANSLATOR_MODEL=deepseek-chat \
codex-zh-bridge
```

然后在另一个终端正常使用 `codex`。已验证：Codex CLI 0.153.4 在 `requires_openai_auth = true` 时会向自定义 provider 发送 ChatGPT token 和 `chatgpt-account-id` 头，bridge 据此自动选择 ChatGPT 后端上游。

## 配置 Codex

```toml
# ~/.codex/config.toml
model_provider = "zh-bridge"

[model_providers.zh-bridge]
name = "Codex ZH Bridge"
base_url = "http://127.0.0.1:8787/v1"
wire_api = "responses"
requires_openai_auth = true      # 使用 ChatGPT 登录；如果用 API key，改成 env_key = "OPENAI_API_KEY"
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `BRIDGE_PORT` | `8787` | 监听端口（只绑定 `127.0.0.1`） |
| `BRIDGE_UPSTREAM` | 自动 | 固定上游地址。不设时按请求判断：带 `chatgpt-account-id` 头 → `https://chatgpt.com/backend-api/codex`，否则 → `https://api.openai.com/v1` |
| `BRIDGE_TRANSLATOR_BASE_URL` | `https://api.openai.com/v1` | 翻译用的 chat-completions 端点，DeepSeek / Qwen / Ollama 等兼容接口均可 |
| `BRIDGE_TRANSLATOR_API_KEY` | `OPENAI_API_KEY` | 翻译端点的 API key |
| `BRIDGE_TRANSLATOR_MODEL` | `gpt-4o-mini` | 翻译模型，`temperature: 0` |
| `BRIDGE_CACHE_FILE` | `~/.codex-zh-bridge/cache.json` | 客户端文本 → 模型文本的持久映射 |
| `BRIDGE_DISABLE` | — | 设为 `1` 时纯透传，不做任何翻译 |
| `BRIDGE_LOG` | `info` | 设为 `debug` 时打印每条消息翻译摘要（长度与方向，不打印正文） |
| `BRIDGE_TRANSLATOR_FAKE` | — | 仅开发用：设为 `1` 时不真正翻译，只给文本打 `[EN]` / `[ZH]` 标签 |

## 工作原理

```
你 (中文) → Codex → [bridge: 中→英] → Responses API
你 (中文) ← Codex ← [bridge: 英→中] ← Responses API (英文)
```

关键问题是**对话历史**：Codex 存储的是它显示给你的中文文本，下一轮请求会把这段中文当作 assistant 历史消息发回来——但模型当初说的是英文。bridge 用一份持久映射解决：每条「客户端看到的文本 → 模型侧文本」存入 `~/.codex-zh-bridge/cache.json`（最多 5000 条，超出丢弃最旧的）。你的中文输入 → 英文译文入缓存；助手英文输出 → 你看到的中文也入缓存。下一轮 assistant 历史消息到达时，bridge 只做查表替换，绝不重新翻译。

- 想偶尔让某条消息**不翻译原文直发**：消息开头加 `!en `（或全角 `！en `），前缀会被剥掉，原文进缓存。
- 代码块、行内代码、URL、文件路径、XML 标签在翻译前会被占位符 `⟦0⟧` 替换，译后还原；占位符丢失时回退原文，bridge 永远不会因为翻译失败而弄坏 Codex。
- 翻译失败的兜底永远是返回原文。

**注意**：如果你的 `~/.codex/AGENTS.md` 或项目级 `AGENTS.md` 里有「Always respond in Chinese」之类的指令，请删掉——这类指令会随请求一起发给模型（实测 `-c project_doc_max_bytes=0` 并不能去掉用户级 AGENTS.md），模型会直接输出中文，bridge 只能把它原样映射回自己，等于翻译没发生。

## English

`codex-zh-bridge` is a localhost HTTP proxy between Codex CLI and the OpenAI Responses API. Chinese user input is translated to English before the model sees it; the model's English output is translated back to Chinese before Codex displays it. A persistent client-text → model-text map (`~/.codex-zh-bridge/cache.json`) keeps assistant history in English even though Codex stores the displayed Chinese. Not translated: system prompts, tool calls/outputs, file contents, reasoning summaries. Streaming is per-message, not per-token. Set `BRIDGE_DISABLE=1` for pure passthrough; prefix a message with `!en ` to send it untranslated. Requires Node.js >= 20, zero runtime dependencies.
