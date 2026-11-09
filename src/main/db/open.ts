import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './migrate';

/** 打开(必要时创建)数据库并迁移到最新版本。filePath 可传 ':memory:' 用于测试。 */
export function openDatabase(filePath: string): Database.Database {
  const isFile = filePath !== ':memory:';
  if (isFile) fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const db = new Database(filePath);
  db.pragma('foreign_keys = ON');
  if (isFile) db.pragma('journal_mode = WAL');

  migrate(db, (fromVersion) => {
    if (!isFile) return;
    // 升级前用 VACUUM INTO 生成一致的备份副本。
    const backupDir = path.join(path.dirname(filePath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(backupDir, `db-v${fromVersion}-${stamp}.sqlite`);
    db.prepare('VACUUM INTO ?').run(target);
  });

  return db;
}
