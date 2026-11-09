/** IPC 通道名,主进程和预加载脚本共用,避免两边拼写不一致。 */
export const IPC = {
  getAppVersion: 'app:getVersion',
  checkForUpdate: 'update:check',
  openReleasePage: 'update:openReleasePage',
} as const;

export type UpdateCheckResult =
  | { status: 'update_available'; current: string; latest: string }
  | { status: 'up_to_date'; current: string }
  | { status: 'no_release'; current: string }
  | { status: 'error'; current: string; message: string };

/** 渲染进程能调用的全部能力。不传路径、不传 URL,只有无参数或句柄式接口。 */
export type Api = {
  getAppVersion(): Promise<string>;
  checkForUpdate(): Promise<UpdateCheckResult>;
  /** 用系统浏览器打开本项目的最新发布页,地址由主进程固定,渲染进程不能指定。 */
  openReleasePage(): Promise<void>;
};
