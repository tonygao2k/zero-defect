import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from './settings';
import { ApiKeyStore, type Encryptor } from './secrets';
import { DEFAULT_SETTINGS } from '../shared/settings';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-settings-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('returns defaults when the file is missing', () => {
    expect(new SettingsStore(path.join(dir, 's.json')).load()).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('round-trips saved settings', () => {
    const store = new SettingsStore(path.join(dir, 's.json'));
    store.save({
      ...DEFAULT_SETTINGS,
      grade: 5,
      provider: 'qwen',
      model: 'qwen3-vl-plus',
    });
    expect(store.load().grade).toBe(5);
    expect(store.load().provider).toBe('qwen');
    expect(store.load().model).toBe('qwen3-vl-plus');
  });

  it('falls back to defaults on a corrupted file', () => {
    const file = path.join(dir, 's.json');
    fs.writeFileSync(file, '{not json');
    expect(new SettingsStore(file).load()).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects invalid input without touching the existing file', () => {
    const file = path.join(dir, 's.json');
    const store = new SettingsStore(file);
    store.save({ ...DEFAULT_SETTINGS, grade: 4 });
    expect(() => store.save({ ...DEFAULT_SETTINGS, grade: 9 })).toThrow();
    expect(() =>
      store.save({ ...DEFAULT_SETTINGS, dailyQuestionCount: 10 }),
    ).toThrow();
    expect(store.load().grade).toBe(4);
  });
});

// 假加密:只做可逆变换,用来验证落盘内容里没有明文。
const fakeEncryptor = (available = true): Encryptor => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(plain, 'utf8').reverse(),
  decrypt: (data) => Buffer.from(data).reverse().toString('utf8'),
});

describe('ApiKeyStore', () => {
  it('stores the key encrypted and reads it back', () => {
    const file = path.join(dir, 'key.bin');
    const store = new ApiKeyStore(file, fakeEncryptor());
    store.set('  sk-or-secret-123  ');
    expect(fs.readFileSync(file).toString('utf8')).not.toContain(
      'sk-or-secret-123',
    );
    expect(store.get()).toBe('sk-or-secret-123');
    expect(store.has()).toBe(true);
  });

  it('refuses to save when the keychain is unavailable, and writes nothing', () => {
    const file = path.join(dir, 'key.bin');
    const store = new ApiKeyStore(file, fakeEncryptor(false));
    expect(() => store.set('sk-or-x')).toThrow(/钥匙串/);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('clears the key when given an empty string', () => {
    const file = path.join(dir, 'key.bin');
    const store = new ApiKeyStore(file, fakeEncryptor());
    store.set('sk-or-x');
    store.set('   ');
    expect(store.has()).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('treats an undecryptable file as not set', () => {
    const file = path.join(dir, 'key.bin');
    fs.writeFileSync(file, 'garbage');
    const broken: Encryptor = {
      ...fakeEncryptor(),
      decrypt: () => {
        throw new Error('bad');
      },
    };
    expect(new ApiKeyStore(file, broken).has()).toBe(false);
  });

  it('writes the key file with owner-only permissions', () => {
    const file = path.join(dir, 'key.bin');
    new ApiKeyStore(file, fakeEncryptor()).set('sk-or-x');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
