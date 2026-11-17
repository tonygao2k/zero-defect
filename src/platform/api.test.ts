import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { api } from './api';
import { IPC, type Api } from '../shared/ipc';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const mocked = vi.mocked(invoke);

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue(null);
});

describe('Rust API bridge', () => {
  it('preserves all API methods and forwards inputs by method', async () => {
    expect(Object.keys(api).sort()).toEqual(Object.keys(IPC).sort());
    for (const method of Object.keys(IPC) as (keyof Api)[]) {
      if (method === 'pickFiles' || method === 'importImage') continue;
      const input = { test: method };
      await (api[method] as (input: unknown) => Promise<unknown>)(input);
      expect(mocked).toHaveBeenLastCalledWith('backend', { method, input });
    }
  });
  it('sends PDF-rendered bytes as a JSON array', async () => {
    await api.importImage({ bytes: new Uint8Array([0, 127, 255]) });
    expect(mocked).toHaveBeenCalledWith('backend', {
      method: 'importImage',
      input: { bytes: [0, 127, 255] },
    });
  });
  it('restores picked PDF arrays to Uint8Array for PDF.js', async () => {
    mocked.mockResolvedValue({
      ok: true,
      value: [{ kind: 'pdf', name: '试卷.pdf', bytes: [37, 80, 68, 70] }],
    });
    const result = await api.pickFiles();
    expect(result.ok).toBe(true);
    if (result.ok && result.value[0].kind === 'pdf') {
      expect(result.value[0].bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(result.value[0].bytes)).toEqual([37, 80, 68, 70]);
    }
    expect(mocked).toHaveBeenCalledWith('backend', {
      method: 'pickFiles',
      input: null,
    });
  });
  it('keeps native cancellation and validation errors intact', async () => {
    mocked.mockResolvedValueOnce({ ok: true, value: [] });
    expect(await api.pickFiles()).toEqual({ ok: true, value: [] });
    mocked.mockResolvedValueOnce({ ok: false, error: '图片过大' });
    expect(await api.pickFiles()).toEqual({ ok: false, error: '图片过大' });
  });
});
