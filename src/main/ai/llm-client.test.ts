import { describe, expect, it, vi } from 'vitest';
import { LlmError, chat, ping } from './llm-client';

const ok = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
  });
const fail = (status: number, body: unknown = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
  });

const base = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  providerLabel: '通义千问',
  apiKey: 'sk-test-secret-key-123',
  model: 'qwen3.8-flash',
  messages: [{ role: 'user' as const, content: 'hi' }],
  sleep: async () => {},
};

describe('chat request', () => {
  it('posts to {baseUrl}/chat/completions with bearer auth and no provider-specific extras', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok('{"a":1}'));
    expect(await chat({ ...base, fetchFn })).toBe('{"a":1}');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
    expect(init.headers.Authorization).toBe('Bearer sk-test-secret-key-123');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('qwen3.8-flash');
    expect(body.max_tokens).toBe(8192);
    expect(body).not.toHaveProperty('response_format');
    expect(body).not.toHaveProperty('temperature');
  });

  it('tolerates a trailing slash in the base URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok('x'));
    await chat({
      ...base,
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
      fetchFn,
    });
    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
  });

  it('joins array-style content parts', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      ok([
        { type: 'text', text: '{"a":' },
        { type: 'text', text: '1}' },
      ]),
    );
    expect(await chat({ ...base, fetchFn })).toBe('{"a":1}');
  });
});

describe('chat errors and retries', () => {
  it('retries 429 and 5xx with exponential backoff, then succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(fail(429))
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(ok('done'));
    const sleeps: number[] = [];
    expect(
      await chat({
        ...base,
        fetchFn,
        sleep: async (ms) => void sleeps.push(ms),
      }),
    ).toBe('done');
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('gives up after the retry budget with the last error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fail(500));
    await expect(
      chat({ ...base, fetchFn, maxRetries: 1 }),
    ).rejects.toMatchObject({ kind: 'server' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, 'auth'],
    [402, 'credits'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [400, 'bad_request'],
  ])('does not retry HTTP %i (%s)', async (code, kind) => {
    const fetchFn = vi.fn().mockResolvedValue(fail(code));
    await expect(chat({ ...base, fetchFn })).rejects.toMatchObject({ kind });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('classifies network failures and timeouts as retryable', async () => {
    const net = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      chat({ ...base, fetchFn: net, maxRetries: 1 }),
    ).rejects.toMatchObject({ kind: 'network' });
    expect(net).toHaveBeenCalledTimes(2);
    const slow = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('t'), { name: 'TimeoutError' }),
      );
    await expect(
      chat({ ...base, fetchFn: slow, maxRetries: 0 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('treats blank content as empty', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok('   '));
    await expect(
      chat({ ...base, fetchFn, maxRetries: 0 }),
    ).rejects.toMatchObject({ kind: 'empty' });
  });

  it('names the provider in messages and never leaks the key', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        fail(401, { error: { message: 'bad key sk-test-secret-key-123' } }),
      );
    const error = (await chat({ ...base, fetchFn }).catch(
      (e) => e,
    )) as LlmError;
    expect(error.message).toContain('通义千问不认这个 API Key');
    expect(error.message).not.toContain('sk-test-secret-key-123');
    expect(error.message).toContain('[已隐藏]');
  });

  it.each([
    ['OpenAI style', { error: { message: 'Model not found' } }],
    ['plain string error', { error: 'Model not found' }],
    ['top-level message', { message: 'Model not found' }],
  ])('surfaces the upstream reason: %s', async (_name, body) => {
    const fetchFn = vi.fn().mockResolvedValue(fail(404, body));
    const error = (await chat({ ...base, fetchFn }).catch(
      (e) => e,
    )) as LlmError;
    expect(error.message).toContain('Model not found');
  });

  it('falls back to the plain message for non-JSON bodies and truncates long reasons', async () => {
    const html = vi.fn().mockResolvedValue(fail(403, '<html>Forbidden</html>'));
    expect(
      ((await chat({ ...base, fetchFn: html }).catch((e) => e)) as LlmError)
        .message,
    ).toBe('通义千问拒绝了这次请求');
    const long = vi
      .fn()
      .mockResolvedValue(fail(400, { error: { message: 'x'.repeat(500) } }));
    const longError = (await chat({ ...base, fetchFn: long }).catch(
      (e) => e,
    )) as LlmError;
    expect(longError.message).toContain('x'.repeat(200));
    expect(longError.message).not.toContain('x'.repeat(201));
  });
});

describe('ping', () => {
  it('passes on a successful response even when the model returned no text (reasoning models)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok(''));
    await expect(ping({ ...base, fetchFn })).resolves.toBeUndefined();
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).max_tokens).toBe(16);
  });

  it('fails fast on a bad key without retrying', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fail(401));
    await expect(ping({ ...base, fetchFn })).rejects.toMatchObject({
      kind: 'auth',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports an unknown model clearly', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(fail(404, { error: { message: 'model not exist' } }));
    const error = (await ping({ ...base, fetchFn }).catch(
      (e) => e,
    )) as LlmError;
    expect(error.kind).toBe('not_found');
    expect(error.message).toContain('换一个模型');
  });
});
