# 超级错题本

这是一个使用 **Tauri v2 + Rust** 构建的桌面错题整理与练习应用。前端保留 React 和现有绿色界面，桌面端能力、SQLite 数据库、图片/PDF 处理和 AI 请求全部由 Rust 原生实现，不依赖 Electron 或 Node.js sidecar。

## 引导式订正

提交智能练习后，可在「修改错题」中按需查看最多两条提问式提示，也可以直接看解析。提示根据本题训练的错因和知识点选择，不包含答案，不额外调用 AI。订正的结果不计入掌握度。

用过提示的薄弱项会进入独立复测，后续新练习优先安排一项待复测内容。首页按「知识点 + 错因」显示最近一次引导后的复测情况，只取另一轮新题的首次独立作答；重复原题和跳过不算复测。提示使用记录仅保存在本地。

## 作答与人工复核

- 「这题不会」和「跳过这题」分开记录。两者都不打断独立连对；主动标记「不会」会优先安排一道同类新题。旧记录会按新口径重算，无法确认是独立首答的历史记录不参与掌握度，原始记录不会删除。
- 识卷时，低置信、识别不清或信息不足的条目不会被快速或批量确认。家长可对照原卷和识别依据，在详情补齐题目和归因。卷面留白可作为待练线索，不算掌握退步。
- 可在做题或订正时申报题目问题，再到「错题库 → 练习题复核」核对。申报不会改分；只有作废才会排除该题及相关证据，显式恢复可重新计入。复核记录留在本机，「家长复核」不设身份验证。作废按题目 ID 生效；生成新题时排除去掉空白后的题干和配图都相同的题，其他会话已分发的题须分别申报。
- 卷面错题证据限于当前年级与学期；未记录学期的旧错题随年级计入。独立练习证据仍按「知识点 × 错因」汇总。卷面错题以确认时刻计入，旧库迁移用最后更新时间，不按原卷日期回填；掌握规则的「跨至少两天」只看独立答对的练习日。

## 开发

```bash
npm install
npm run dev:web       # 只启动前端开发服务器
npm start             # 启动 Tauri 开发应用
npm test              # Vitest
npm run test:rust     # Rust 单元与集成测试
npm run lint
```

构建 Web 资源：

```bash
npm run build:web
```

构建桌面安装包：

```bash
npm run build         # 当前平台的 Tauri 包
npm run package       # 只生成未打包的应用目录
```

`npm run build`（或 `npm run make`）成功后，会自动将最终应用和安装包复制到项目根目录的 `release/`，例如 `release/错了吗.app` 和 `release/zero-defect_1.0.1_x64.dmg`。安装包文件名统一使用 `package.json` 中的英文包名 `zero-defect`，避免 GitHub Release 上传时过滤中文名称；应用显示名称仍为“错了吗”。编译缓存仍保留在 Tauri 默认目录，`release/` 不提交到 Git。

macOS 制作 DMG 时如果遇到 Finder AppleEvent 超时，可用 `CI=true npm run build` 重试，同样会自动整理到 `release/`。

### 发布与检查更新

设置页的“检查更新”查询 `tonygao2k/zero-defect` 的最新正式 GitHub Release，比较版本号后，“前往下载”打开该发布页，供用户下载安装包更新。它不会读取开发者电脑上的 `release/`，也不会自动下载或安装。

支持自动提醒的版本在启动 5 秒后后台检查更新，运行期间每 6 小时再次检查。发现新版本时，在右下角显示不打断操作的提醒，可选择“前往下载”或“稍后再说”。同一版本在本次 App 运行期间只提醒一次，重新启动后会再次检查；自动检查失败时静默处理，不弹出错误。设置页仍可随时手动检查更新。检查只查询版本信息，不会上传学习数据。

#### 1. 同步版本号（3 个配置文件 + 2 个 lock 文件）

以下以从 `1.0.1` 发布到 `1.0.2` 为例。先完成本次要发布的功能或修复，再把以下位置的项目版本号统一改为 `1.0.2`：

| 文件                        | 需要同步的位置                                               |
| --------------------------- | ------------------------------------------------------------ |
| `package.json`              | 顶层 `version`                                               |
| `src-tauri/tauri.conf.json` | 顶层 `version`                                               |
| `src-tauri/Cargo.toml`      | `[package]` 中的 `version`                                   |
| `package-lock.json`         | 顶层 `version` 和 `packages[""].version`，共两处             |
| `src-tauri/Cargo.lock`      | `name = "zero-defect"` 所属 `[[package]]` 条目中的 `version` |

`Cargo.lock` 不只记录第三方依赖，也记录项目自身的版本。该条目通常在文件后部，搜索 `name = "zero-defect"` 即可找到：

```toml
[[package]]
name = "zero-defect"
version = "1.0.2"
```

只修改项目自身的版本，不要全局替换 lock 文件中的所有 `1.0.1`，也不要修改其他依赖的版本或 checksum。配置文件和 lock 文件使用 `1.0.2`，Git 标签使用带 `v` 前缀的 `v1.0.2`。

#### 2. 本地检查并提交代码

在项目根目录运行：

```bash
node scripts/check-release-version.mjs v1.0.2
npm run typecheck
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
git diff --check
git diff
```

版本检查脚本会同时校验标签、3 个配置文件、`package-lock.json` 的两处项目版本，以及 `Cargo.lock` 中项目自身的版本；版本不一致、缺失或 `Cargo.lock` 中的项目条目不唯一时会报错，并列出各处版本。脚本只检查，不会自动修改文件；CI 标签发布时也会执行同样的校验。Rust 测试使用 `--locked`，若提示需要更新 lock 文件，先解决版本同步问题再继续。所有检查通过后，确认本次功能或修复已提交，或已一并加入暂存区，再提交版本文件并推送：

```bash
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "发布 1.0.2"
git push origin main
```

如果实际发布分支是 `master`，将上述 `main` 换成 `master`。仅推送分支会运行检查和测试，不会生成安装包或发布 Release。

#### 3. 创建并推送版本标签

确认当前提交就是要发布的版本，且分支检查通过后，再执行：

```bash
git tag v1.0.2
git push origin v1.0.2
```

两条命令分行执行，第一行末尾不要加 `\`。标签指向执行 `git tag` 时的当前提交，未提交的修改不会进入发布。仅在本地创建标签不会触发 GitHub Actions，推送标签后才开始打包发布。下次发布时，将本节中的 `1.0.2` 和 `v1.0.2` 换成新的版本号；不要重复使用或移动已经发布的版本标签。

#### 4. 确认发布结果

在 GitHub 的 **Actions → Desktop builds** 中查看该标签对应的运行，等待检查、三个平台的构建和 `release` 作业全部成功，再到 **Releases** 确认对应版本包含以下安装包：

- `zero-defect_1.0.2_aarch64.dmg`：Apple Silicon Mac。
- `zero-defect_1.0.2_x64.dmg`：Intel Mac。
- `zero-defect_1.0.2_x64-setup.exe`：Windows NSIS 安装包。
- `zero-defect_1.0.2_x64_zh-CN.msi`：Windows MSI 安装包。

若检查或构建失败，先查看失败步骤的日志；所有平台构建成功前不会执行发布作业。已安装支持自动提醒版本的用户会在后台检查发现新版本后收到提醒；尚未包含此功能的旧版本仍需在设置页点击“检查更新”。只有正式发布的版本号高于用户本机版本时才会提示更新；重新上传同版本安装包不会提示更新。

#### 工作流触发与附件保留

推送到 `main` / `master`、创建或更新 PR，以及手动运行工作流时，只在单个 macOS Intel runner 上执行类型检查、前端测试和 Rust 测试，不生成安装包或上传构建附件。

只有推送 `v*` 版本标签才会打包发布：先校验版本一致性并通过检查和测试，再分别构建 macOS Intel、macOS Apple Silicon（ARM64）和 Windows 安装包，统一从 `release/` 收集 DMG、NSIS EXE 和 MSI。所有平台构建成功后，工作流会将安装包上传至同一个 GitHub Release。用于发布中转的 Actions 安装包附件只保留 3 天，GitHub Release 中的安装包不受该保留期限影响。安装了旧版本的用户随后即可通过“检查更新”发现新版本。仅在本地构建不会向用户发布更新。

macOS 在各自架构的 GitHub runner 上原生构建：Intel 使用 `macos-15-intel`，Apple Silicon 使用 `macos-15`。发布页中，Intel Mac 选择文件名带 `_x64.dmg` 的安装包，M 系列芯片 Mac 选择带 `_aarch64.dmg` 的安装包；两者分开发布，不是 Universal 通用包。本机 `npm run build` 仍默认构建当前 Rust 工具链对应的架构。

AI 服务和模型配置集中在 [`src-tauri/config/ai.json`](src-tauri/config/ai.json)。Rust 后端从这份配置读取接口地址和模型名称，设置页通过后端接口显示当前配置；修改后重新构建应用即可生效。模型名称不放在 `package.json`，因为 `package.json` 只负责 Node/Vite 的开发和构建元数据，安装后的桌面应用也不依赖 Node 运行时。

macOS 构建需要 Xcode Command Line Tools。Windows 构建需要 Rust 的 MSVC 工具链和 WebView2，CI 工作流位于 `.github/workflows/desktop.yml`，会生成 NSIS 和 MSI 安装包。发布版本仍需使用各平台自己的代码签名证书完成签名和公证。

## 数据迁移

首次启动时，应用会在 Tauri 数据目录中创建新的数据库，并自动读取旧 Electron 版本的 `zero-defect.sqlite`、设置和图片目录。迁移使用 SQLite backup API，包含 WAL 内容；原文件只读保留，目标数据库在完整性检查通过后才发布。旧数据库中保存的 API Key 会继续使用；如果历史版本只有系统安全存储中的加密 Key，则需要在设置页重新输入。

## 运行时目录

应用数据目录由 Tauri 的应用标识符决定：

- macOS：`~/Library/Application Support/com.zerodefect.app/`
- Windows：`%APPDATA%\\com.zerodefect.app\\`

其中包含 SQLite 数据库、导入图片和应用设置。请不要把数据库文件分享给其他人。

## 验证范围

本地验证包括前端测试、Rust 测试、Clippy、格式化检查、真实旧数据库读取、图片/PDF 选择器、HEIC 解码，以及 macOS `.app` 和 `.dmg` 构建。AI 集成测试使用本地 HTTP mock，不会产生线上模型费用；Windows 和 macOS ARM64 构建由 CI 工作流配置，当前 Intel 开发机未执行这两种架构的原生编译。
