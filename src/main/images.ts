import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** 把任意输入图片规整成 JPEG(缩放、去 EXIF)。Electron 实现见 image-normalizer.ts,测试里可替换。 */
export type Normalizer = (input: Buffer) => Buffer;

export const MAX_INPUT_BYTES = 30 * 1024 * 1024;

type Pending = { file: string; hash: string };

/**
 * 图片句柄管理。渲染进程只拿到 imageId,真实路径只存在这里。
 * 流程:import(落到临时目录)→ 分析成功后 promote(移入正式目录)→ 放弃草稿时 removeStored。
 */
export class ImageStore {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly tempDir: string,
    private readonly imageDir: string,
    private readonly normalize: Normalizer,
  ) {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(imageDir, { recursive: true });
  }

  /** 句柄只在内存里,重启后失效,所以启动时清掉上次遗留的临时文件。 */
  clearTemp(): void {
    for (const name of fs.readdirSync(this.tempDir)) {
      fs.rmSync(path.join(this.tempDir, name), { force: true });
    }
    this.pending.clear();
  }

  import(input: Buffer): { imageId: string; hash: string } {
    if (input.length === 0) throw new Error('图片是空的');
    if (input.length > MAX_INPUT_BYTES)
      throw new Error('图片太大,请选择小于 30MB 的图片');

    // 哈希基于规整后的 JPEG 字节:同一张图重复导入得到同一个哈希。
    const jpeg = this.normalize(input);
    const hash = crypto.createHash('sha256').update(jpeg).digest('hex');

    const imageId = crypto.randomUUID();
    const file = path.join(this.tempDir, `${imageId}.jpg`);
    fs.writeFileSync(file, jpeg, { mode: 0o600 });
    this.pending.set(imageId, { file, hash });
    return { imageId, hash };
  }

  private entry(imageId: string): Pending {
    const found = this.pending.get(imageId);
    if (!found) throw new Error('图片已失效,请重新选择');
    return found;
  }

  hashOf(imageId: string): string {
    return this.entry(imageId).hash;
  }

  read(imageId: string): Buffer {
    return fs.readFileSync(this.entry(imageId).file);
  }

  /**
   * 移入正式目录并返回最终路径。文件名取 key(默认是内容哈希)的前 32 位十六进制,
   * 不含任何用户输入。同一张照片上的不同错题传不同的 key,各存一份,互不影响。
   */
  promote(imageId: string, key?: string): string {
    const { file, hash } = this.entry(imageId);
    const name = (key ?? hash).slice(0, 32);
    if (!/^[0-9a-f]{32}$/.test(name)) throw new Error('图片标识不合法');
    const target = path.join(this.imageDir, `${name}.jpg`);
    fs.copyFileSync(file, target);
    fs.rmSync(file, { force: true });
    this.pending.delete(imageId);
    return target;
  }

  /** 放弃一个还没入库的临时图片。 */
  discard(imageId: string): void {
    const found = this.pending.get(imageId);
    if (!found) return;
    fs.rmSync(found.file, { force: true });
    this.pending.delete(imageId);
  }

  /** 删除已入库的正式图片(放弃草稿时用)。路径必须位于正式目录内,否则忽略。 */
  removeStored(storedPath: string | null): void {
    if (!storedPath) return;
    const resolved = path.resolve(storedPath);
    if (path.dirname(resolved) !== path.resolve(this.imageDir)) return;
    fs.rmSync(resolved, { force: true });
  }
}
