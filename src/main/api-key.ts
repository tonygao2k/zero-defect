import type Database from 'better-sqlite3';

const KEY = 'bailian_api_key';

/**
 * 百炼 API Key,保存在本地 SQLite 的 app_settings 表(设计文档技术表)。
 * 只在主进程使用:界面只能写入(set)和询问是否已设置(has),永远读不到密钥本身。
 * 数据库文件没有加密,他人拿到文件就能读到 Key;因此备份副本会清除它(见 open.ts)。
 */
export class ApiKeyStore {
  constructor(private readonly db: Database.Database) {}

  /** 传空字符串表示清除。 */
  set(key: string): void {
    const trimmed = key.trim();
    if (!trimmed) return this.clear();
    this.db
      .prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .run(KEY, trimmed);
  }

  get(): string | null {
    const row = this.db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(KEY) as { value: string } | undefined;
    return row?.value ?? null;
  }

  has(): boolean {
    return this.get() !== null;
  }

  clear(): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(KEY);
  }
}

export const API_KEY_SETTING = KEY;
