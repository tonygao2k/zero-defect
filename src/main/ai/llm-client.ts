export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
};

export type LlmErrorKind =
  | 'auth' // 401:Key 无效
  | 'forbidden' // 403:被拒绝(权限、欠费、内容审核等,以返回的原因为准)
  | 'credits' // 402:余额不足
  | 'not_found' // 404:模型不存在或不可用
  | 'rate_limit' // 429
  | 'server' // 5xx
  | 'bad_request' // 其他 4xx
  | 'network'
  | 'timeout'
  | 'empty' // 200 但没有内容
  | 'truncated'; // 输出达到长度上限被截断,重试也一样

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

const RETRYABLE: ReadonlySet<LlmErrorKind> = new Set([
  'rate_limit',
  'server',
  'network',
  'timeout',
]);

export type ChatOptions = {
  /** OpenAI 兼容接口的基础地址,如 https://dashscope.aliyuncs.com/compatible-mode/v1 */
  baseUrl: string;
  /** 用在错误提示里,如“通义千问”。 */
  providerLabel: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  fetchFn?: typeof fetch;
  /** 测试里替换成立即返回,避免真的等待退避时间。 */
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
  maxTokens?: number;
  /** 百炼的思考模式开关。填 false 可以关掉长篇推理,明显更快;不填就用模型默认。 */
  enableThinking?: boolean;
  /** 每次成功返回后调用,用来记录 token 用量(成本核算)。 */
  onUsage?: (usage: LlmUsage) => void;
};

export type LlmUsage = { promptTokens: number; completionTokens: number };

/**
 * 单次输出上限。推理模型的思考内容通常也计入输出,这里留得比较宽。
 * 各家的上限不同,若超过所选模型的限制,服务商会返回 400,错误信息会显示在界面上。
 */
export const DEFAULT_MAX_TOKENS = 8192;

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

function classify(status: number): LlmErrorKind {
  if (status === 401) return 'auth';
  if (status === 402) return 'credits';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function messageFor(kind: LlmErrorKind, provider: string): string {
  switch (kind) {
    case 'auth':
      return `${provider}不认这个 API Key,请在设置里检查`;
    case 'forbidden':
      return `${provider}拒绝了这次请求`;
    case 'credits':
      return `${provider}账户余额不足,请充值后再试`;
    case 'not_found':
      return `${provider}找不到所需的模型,请确认百炼账号已开通`;
    case 'rate_limit':
      return `${provider}提示请求太频繁,请稍后再试`;
    case 'server':
      return `${provider}暂时出了问题,请稍后再试`;
    case 'bad_request':
      return `${provider}拒绝了这次请求,请稍后重试`;
    case 'network':
      return `无法连接到${provider},请检查网络`;
    case 'timeout':
      return `${provider}响应太慢,请稍后再试`;
    case 'empty':
      return `${provider}没有返回内容,请重试`;
    case 'truncated':
      return `这份试卷的题太多,${provider}一次说不完。请把试卷分成两次提交`;
  }
}

/** 取出服务商在错误响应里给出的原因,截短并抹掉形似密钥的内容。 */
async function upstreamMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    const raw =
      typeof body?.error === 'string'
        ? body.error
        : (body?.error?.message ?? body?.message);
    if (typeof raw !== 'string') return '';
    return raw
      .replace(/sk-[\w-]{8,}/g, '[已隐藏]')
      .trim()
      .slice(0, 200);
  } catch {
    return '';
  }
}

function contentOf(body: unknown): string {
  const content = (body as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('');
  }
  return '';
}

/** 发一次请求,返回解析后的响应体。HTTP 错误、网络错误统一抛 LlmError。 */
async function request(opts: ChatOptions): Promise<unknown> {
  const fetchFn = opts.fetchFn ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      // 不传 temperature 和 response_format:各家对这些参数的支持不一致,
      // 输出格式靠提示词约束,解析时再容错。
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(opts.enableThinking === undefined
          ? {}
          : { enable_thinking: opts.enableThinking }),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    const kind =
      name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
    throw new LlmError(kind, messageFor(kind, opts.providerLabel));
  }

  if (!res.ok) {
    const kind = classify(res.status);
    const detail = await upstreamMessage(res);
    const base = messageFor(kind, opts.providerLabel);
    throw new LlmError(kind, detail ? `${base}(${detail})` : base, res.status);
  }

  try {
    return await res.json();
  } catch {
    throw new LlmError(
      'empty',
      messageFor('empty', opts.providerLabel),
      res.status,
    );
  }
}

async function attempt(opts: ChatOptions): Promise<string> {
  const body = await request(opts);
  const usage = (
    body as { usage?: { prompt_tokens?: number; completion_tokens?: number } }
  )?.usage;
  if (usage && opts.onUsage) {
    opts.onUsage({
      promptTokens: Number(usage.prompt_tokens) || 0,
      completionTokens: Number(usage.completion_tokens) || 0,
    });
  }
  const finish = (body as { choices?: { finish_reason?: unknown }[] })
    ?.choices?.[0]?.finish_reason;
  if (finish === 'length') {
    throw new LlmError(
      'truncated',
      messageFor('truncated', opts.providerLabel),
    );
  }
  const text = contentOf(body).trim();
  if (!text)
    throw new LlmError('empty', messageFor('empty', opts.providerLabel));
  return text;
}

/** 发送一次对话请求并返回模型文本。限流、5xx、断网、超时会指数退避重试;鉴权和余额类错误不重试。 */
export async function chat(opts: ChatOptions): Promise<string> {
  const maxRetries = opts.maxRetries ?? 2;
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: LlmError | undefined;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await attempt(opts);
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      lastError = error;
      if (!RETRYABLE.has(error.kind) || i === maxRetries) break;
      await sleep(1000 * 2 ** i);
    }
  }
  throw lastError!;
}

/**
 * 用所选模型发一次极小的真实请求,验证 Key、地址、模型 ID 是否一起可用。
 * 推理模型可能把很小的输出额度全用在思考上而没有正文,所以只要服务商返回成功就算通过。
 */
export async function ping(
  opts: Omit<ChatOptions, 'messages' | 'maxTokens'>,
): Promise<void> {
  await request({
    ...opts,
    messages: [{ role: 'user', content: '回复“好”' }],
    maxTokens: 16,
    timeoutMs: opts.timeoutMs ?? 30_000,
  });
}
