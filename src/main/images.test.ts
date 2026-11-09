import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ImageStore, MAX_INPUT_BYTES, type Normalizer } from './images';

let root: string;
let store: ImageStore;
// 测试用规整器:原样返回,另有一个把内容改写的版本。
const identity: Normalizer = (b) => b;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-img-'));
  store = new ImageStore(
    path.join(root, 'tmp'),
    path.join(root, 'images'),
    identity,
  );
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

describe('ImageStore', () => {
  it('imports into the temp dir and hashes the normalized bytes', () => {
    const data = Buffer.from('fake-image-bytes');
    const { imageId, hash } = store.import(data);
    expect(hash).toBe(sha(data));
    expect(store.read(imageId).equals(data)).toBe(true);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toHaveLength(1);
  });

  it('gives the same hash for the same content and different ids', () => {
    const a = store.import(Buffer.from('same'));
    const b = store.import(Buffer.from('same'));
    expect(a.hash).toBe(b.hash);
    expect(a.imageId).not.toBe(b.imageId);
  });

  it('hashes what the normalizer returns, not the raw input', () => {
    const s = new ImageStore(path.join(root, 't2'), path.join(root, 'i2'), () =>
      Buffer.from('normalized'),
    );
    expect(s.import(Buffer.from('raw-a')).hash).toBe(
      s.import(Buffer.from('raw-b')).hash,
    );
  });

  it('promote moves the file into the image dir and invalidates the handle', () => {
    const { imageId, hash } = store.import(Buffer.from('keep me'));
    const stored = store.promote(imageId);
    expect(path.dirname(stored)).toBe(path.join(root, 'images'));
    expect(path.basename(stored)).toBe(`${hash.slice(0, 32)}.jpg`);
    expect(fs.readFileSync(stored, 'utf8')).toBe('keep me');
    expect(fs.readdirSync(path.join(root, 'tmp'))).toHaveLength(0);
    expect(() => store.read(imageId)).toThrow(/失效/);
  });

  it('rejects unknown handles', () => {
    expect(() => store.read('nope')).toThrow(/失效/);
    expect(() => store.promote('nope')).toThrow(/失效/);
    expect(() => store.hashOf('../../etc/passwd')).toThrow(/失效/);
  });

  it('discard removes the temp file', () => {
    const { imageId } = store.import(Buffer.from('x'));
    store.discard(imageId);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toHaveLength(0);
    expect(() => store.read(imageId)).toThrow();
  });

  it('removeStored only deletes files inside the image dir', () => {
    const stored = store.promote(store.import(Buffer.from('a')).imageId);
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'safe');
    store.removeStored(outside);
    expect(fs.existsSync(outside)).toBe(true);
    store.removeStored(stored);
    expect(fs.existsSync(stored)).toBe(false);
    expect(() => store.removeStored(null)).not.toThrow();
  });

  it('rejects empty and oversized input', () => {
    expect(() => store.import(Buffer.alloc(0))).toThrow(/空/);
    expect(() => store.import(Buffer.alloc(MAX_INPUT_BYTES + 1))).toThrow(
      /太大/,
    );
  });

  it('clearTemp wipes leftovers and forgets handles', () => {
    const { imageId } = store.import(Buffer.from('x'));
    store.clearTemp();
    expect(fs.readdirSync(path.join(root, 'tmp'))).toHaveLength(0);
    expect(() => store.read(imageId)).toThrow();
  });
});
