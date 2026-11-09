import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Settings,
} from '../shared/settings';

/** 家长设置的 JSON 文件存储。文件损坏或字段不合法时回退到默认值,不让应用起不来。 */
export class SettingsStore {
  constructor(private readonly file: string) {}

  load(): Settings {
    try {
      const parsed = SettingsSchema.safeParse(
        JSON.parse(fs.readFileSync(this.file, 'utf8')),
      );
      if (parsed.success) return parsed.data;
    } catch {
      // 文件不存在或不是合法 JSON,使用默认值。
    }
    return DEFAULT_SETTINGS;
  }

  /** 入参不合法时抛错,不写入。先写临时文件再改名,避免写一半断电留下坏文件。 */
  save(input: unknown): Settings {
    const settings = SettingsSchema.parse(input);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, this.file);
    return settings;
  }
}
