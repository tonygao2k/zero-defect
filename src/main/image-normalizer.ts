import { nativeImage } from 'electron';
import type { Normalizer } from './images';

/** 长边上限。设计文档 8.1:缩放到长边不超过约 2000px。 */
export const MAX_EDGE = 2000;
const JPEG_QUALITY = 85;

/**
 * 用 Electron 的 nativeImage 解码、缩放并重新编码为 JPEG。
 * 重新编码会丢弃原图的 EXIF 等元数据(含拍摄位置)。
 */
export const electronNormalizer: Normalizer = (input) => {
  let image = nativeImage.createFromBuffer(input);
  if (image.isEmpty()) throw new Error('无法识别这个图片文件');

  const { width, height } = image.getSize();
  const longest = Math.max(width, height);
  if (longest > MAX_EDGE) {
    const scale = MAX_EDGE / longest;
    image = image.resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      quality: 'best',
    });
  }
  return image.toJPEG(JPEG_QUALITY);
};
