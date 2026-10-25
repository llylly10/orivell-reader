/**
 * Together AI client. Server-side only. Raw fetch, OpenAI-compatible SSE.
 *
 * Things learned the hard way, kept on purpose:
 * 1. A named User-Agent. Together's WAF has 403'd the default undici agent.
 * 2. stream_options.include_usage, so the cost receipt is real, not a guess.
 * 3. Errors come back as JSON: surface error.message, not the raw body.
 * 4. enable_thinking:false keeps reasoners from spending the budget thinking.
 *    Verified per model on 2026-10-08 with the full sample article (11k tokens).
 */

export const TOGETHER_URL = "https://api.together.xyz/v1/chat/completions";
export const APP_UA = "Gloss/0.1";

/**
 * 自定义 OpenAI 兼容通道：设了 AI_BASE_URL 就把全部请求路由到自己的模型服务，
 * 不再走 Together。各家都兼容这个协议：
 *   GLM      https://open.bigmodel.cn/api/paas/v4        （配 AI_API_KEY + AI_MODEL=glm-4.7-flash 等）
 *   DeepSeek https://api.deepseek.com/v1
 *   Qwen     https://dashscope.aliyuncs.com/compatible-mode/v1
 *   本地     http://127.0.0.1:11434/v1（ollama）等
 * 访客自贴的 key 是 Together 的 key，仍走 Together。
 */
const CUSTOM_BASE = process.env.AI_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
const CUSTOM_KEY = process.env.AI_API_KEY?.trim() ?? "";
const CUSTOM_MODEL = process.env.AI_MODEL?.trim() ?? "";

function chatEndpoint(): string {
  return CUSTOM_BASE.endsWith("/chat/completions") ? CUSTOM_BASE : `${CUSTOM_BASE}/chat/completions`;
}

/** 自定义 AI 服务是否已配置（AI_BASE_URL）。路由用它决定 key/额度逻辑。 */
export function usingCustomAI(): boolean {
  return Boolean(CUSTOM_BASE);
}

import { MODELS, costFor, type ModelEntry, type ModelKey, type StreamEvent, type Usage } from "./models";

export { MODELS, DEFAULT_MODEL, isModelKey, costFor } from "./models";
export type { ModelKey, StreamEvent, Usage } from "./models";

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

type Chunk = {
  choices?: { delta?: { content?: string; reasoning_content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

function errorMessage(status: number, body: string, provider = "Together"): string {
  let msg = body.slice(0, 280);
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof j.error === "string") msg = j.error;
    else if (j.error?.message) msg = j.error.message;
    else if (j.message) msg = j.message;
  } catch {
    /* not JSON */
  }
  if (status === 401) return `${provider} rejected that API key. Check it and try again.`;
  if (status === 429) return `${provider} is rate limiting this key. Wait a moment, or use your own key.`;
  return `${provider} API ${status}: ${msg}`;
}

export async function* streamChat(req: {
  messages: ChatMessage[];
  model: ModelKey;
  apiKey?: string;
  /** 浏览器「添加密钥」里存的模型名——自定义通道下优先于 AI_MODEL 环境变量 */
  modelName?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Tools the model may call; a call ends the stream with a "tool" event instead of an answer. */
  tools?: readonly unknown[];
  /** "none" sends the tools (a conversation that already used one needs them) but asks for an answer. */
  toolChoice?: "auto" | "none";
}): AsyncGenerator<StreamEvent> {
  const model: ModelEntry = MODELS[req.model];
  // 配了自定义服务后，浏览器「添加密钥」里的 key 也发给自定义服务（key 存浏览器，
  // 不落盘）；没有浏览器 key 才用服务端的 AI_API_KEY。访客密钥仅在没有自定义
  // 服务时走 Together。
  const custom = Boolean(CUSTOM_BASE);
  const provider = custom ? "your AI provider" : "Together";
  const endpoint = custom ? chatEndpoint() : TOGETHER_URL;
  const apiKey = custom
    ? req.apiKey?.trim() || CUSTOM_KEY
    : req.apiKey?.trim() || process.env.TOGETHER_API_KEY || "";
  const modelId = custom ? req.modelName?.trim() || CUSTOM_MODEL || model.id : model.id;
  if (!apiKey && !custom) {
    yield {
      type: "error",
      text: "No Together API key. Set TOGETHER_API_KEY, or add your own key.",
    };
    return;
  }

  yield { type: "meta", model: custom ? modelId : model.label };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      signal: req.signal,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "User-Agent": APP_UA,
      },
      body: JSON.stringify({
        model: modelId,
        stream: true,
        stream_options: { include_usage: true },
        temperature: req.temperature ?? 0.4,
        max_tokens: req.maxTokens ?? 900,
        // Together 的思考开关是私有扩展，别的兼容服务可能拒收未知字段
        ...(custom ? {} : { chat_template_kwargs: { enable_thinking: false } }),
        messages: req.messages,
        ...(req.tools ? { tools: req.tools, tool_choice: req.toolChoice ?? "auto" } : {}),
      }),
    });
  } catch (e) {
    if (req.signal?.aborted) return;
    yield { type: "error", text: `Could not reach ${provider}: ${String(e)}` };
    return;
  }

  if (!res.ok || !res.body) {
    yield { type: "error", text: errorMessage(res.status, await res.text().catch(() => ""), provider) };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawContent = false;
  let sawReasoning = false;
  // A tool call arrives in pieces, by index: its id and name once, its arguments in fragments.
  const calls: { id: string; name: string; args: string }[] = [];

  const finish = (): StreamEvent => {
    if (calls[0]?.name) return { type: "tool", id: calls[0].id || "call_0", name: calls[0].name, args: calls[0].args };
    return !sawContent && sawReasoning ? { type: "error", text: `${model.label} answered only in its reasoning. Try again.` } : { type: "done" };
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        yield finish();
        return;
      }
      let chunk: Chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.reasoning_content) sawReasoning = true;
      for (const tc of delta?.tool_calls ?? []) {
        const c = (calls[tc.index] ??= { id: "", name: "", args: "" });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
      }
      if (delta?.content) {
        sawContent = true;
        yield { type: "content", text: delta.content };
      }
      if (chunk.usage && typeof chunk.usage.completion_tokens === "number") {
        const pt = chunk.usage.prompt_tokens ?? 0;
        const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
        const ct = chunk.usage.completion_tokens ?? 0;
        yield {
          type: "usage",
          // 自定义通道的计价随服务商而定，先记 0；token 数仍是真实的
          usage: { promptTokens: pt, cachedTokens: cached, completionTokens: ct, costUsd: custom ? 0 : costFor(req.model, pt, cached, ct) },
        };
      }
    }
  }
  yield finish();
}

/** Non-streaming JSON completion, for structured output like the brief. */
export async function completeJSON<T>(req: {
  messages: ChatMessage[];
  model: ModelKey;
  apiKey?: string;
  /** 浏览器「添加密钥」里存的模型名——自定义通道下优先于 AI_MODEL 环境变量 */
  modelName?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Let the model reason before it answers, for checking a text against itself. Its thinking spends from maxTokens. */
  thinking?: boolean;
}): Promise<{ ok: true; data: T; usage: Usage } | { ok: false; error: string }> {
  const model: ModelEntry = MODELS[req.model];
  const custom = Boolean(CUSTOM_BASE);
  const provider = custom ? "your AI provider" : "Together";
  const apiKey = custom
    ? req.apiKey?.trim() || CUSTOM_KEY
    : req.apiKey?.trim() || process.env.TOGETHER_API_KEY || "";
  const modelId = custom ? req.modelName?.trim() || CUSTOM_MODEL || model.id : model.id;
  if (!apiKey && !custom) {
    return {
      ok: false,
      error: "No Together API key. Set TOGETHER_API_KEY, or add your own key.",
    };
  }

  let res: Response;
  try {
    res = await fetch(chatEndpoint(), {
      method: "POST",
      signal: req.signal,
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), "User-Agent": APP_UA },
      body: JSON.stringify({
        model: modelId,
        temperature: 0.3,
        max_tokens: req.maxTokens ?? 1400,
        ...(custom ? {} : { chat_template_kwargs: { enable_thinking: Boolean(req.thinking) } }),
        response_format: { type: "json_object" },
        messages: req.messages,
      }),
    });
  } catch (e) {
    return { ok: false, error: `Could not reach ${provider}: ${String(e)}` };
  }
  const body = await res.text();
  if (!res.ok) return { ok: false, error: errorMessage(res.status, body, provider) };

  try {
    const j = JSON.parse(body) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const raw = j.choices?.[0]?.message?.content ?? "";
    const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const data = JSON.parse(jsonText) as T;
    const pt = j.usage?.prompt_tokens ?? 0;
    const cached = j.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const ct = j.usage?.completion_tokens ?? 0;
    return { ok: true, data, usage: { promptTokens: pt, cachedTokens: cached, completionTokens: ct, costUsd: custom ? 0 : costFor(req.model, pt, cached, ct) } };
  } catch {
    return { ok: false, error: "The model returned something that was not valid JSON. Try again." };
  }
}
