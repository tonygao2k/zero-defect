import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from './settings';
import Database from 'better-sqlite3';
import { ApiKeyStore } from './api-key';
import { openDatabase, scrubSecrets } from './db/open';
import { migrate } from './db/migrate';
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
    store.save({ ...DEFAULT_SETTINGS, grade: 5, semester: 2 });
    expect(store.load().grade).toBe(5);
    expect(store.load().semester).toBe(2);
  });

  it('ignores retired fields from old settings files', () => {
    const file = path.join(dir, 's.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ grade: 4, provider: 'kimi', model: 'x' }),
    );
    const loaded = new SettingsStore(file).load();
    expect(loaded.grade).toBe(4);
    expect(loaded).not.toHaveProperty('provider');
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
    expect(store.load().grade).toBe(4);
  });
});

describe('ApiKeyStore', () => {
  it('stores the key in sqlite and reads it back', () => {
    const store = new ApiKeyStore(openDatabase(':memory:'));
    expect(store.has()).toBe(false);
    store.set('  sk-secret-123  ');
    expect(store.get()).toBe('sk-secret-123');
    expect(store.has()).toBe(true);
  });

  it('replaces an existing key', () => {
    const store = new ApiKeyStore(openDatabase(':memory:'));
    store.set('sk-old');
    store.set('sk-new');
    expect(store.get()).toBe('sk-new');
  });

  it('clears the key when given an empty string', () => {
    const store = new ApiKeyStore(openDatabase(':memory:'));
    store.set('sk-x');
    store.set('   ');
    expect(store.has()).toBe(false);
  });

  it('scrubs the key from backup copies, including leftover bytes', () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-bk-'));
    const file = path.join(dir2, 'app.sqlite');
    const db = openDatabase(file);
    new ApiKeyStore(db).set('sk-very-secret-key-0123456789');
    const backup = path.join(dir2, 'backup.sqlite');
    db.prepare('VACUUM INTO ?').run(backup);
    db.close();
    expect(fs.readFileSync(backup).includes('sk-very-secret-key')).toBe(true);

    scrubSecrets(backup);

    expect(fs.readFileSync(backup).includes('sk-very-secret-key')).toBe(false);
    const copy = new Database(backup);
    expect(new ApiKeyStore(copy).has()).toBe(false);
    copy.close();
  });

  it('tolerates backups of databases that predate app_settings', () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-bk-'));
    const file = path.join(dir2, 'old.sqlite');
    const old = new Database(file);
    migrate(old, undefined, 3);
    old.close();
    expect(() => scrubSecrets(file)).not.toThrow();
  });
});
