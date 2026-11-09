import fs from 'node:fs';
import path from 'node:path';

/** 对 Electron safeStorage 的最小抽象,便于在测试里替换。 */
export type Encryptor = {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
};

/**
 * API Key 的加密存储(每个服务商一份)。只在主进程使用:
 * 渲染进程只能写入(set)和询问是否已设置(has),永远读不到密钥本身。
 */
export class ApiKeyStore {
  constructor(
    private readonly file: string,
    private readonly encryptor: Encryptor,
  ) {}

  set(key: string): void {
    const trimmed = key.trim();
    if (!trimmed) {
      this.clear();
      return;
    }
    // 系统钥匙串不可用时拒绝保存,绝不退回明文。
    if (!this.encryptor.isAvailable()) {
      throw new Error('系统钥匙串不可用,无法安全保存密钥');
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, this.encryptor.encrypt(trimmed), {
      mode: 0o600,
    });
  }

  /** 仅供主进程内部调用服务商接口时使用。解密失败(如钥匙串变更)视为未设置。 */
  get(): string | null {
    try {
      return this.encryptor.decrypt(fs.readFileSync(this.file));
    } catch {
      return null;
    }
  }

  has(): boolean {
    return this.get() !== null;
  }

  clear(): void {
    fs.rmSync(this.file, { force: true });
  }
}
