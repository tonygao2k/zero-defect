# 超级错题本

这是一个使用 **Tauri v2 + Rust** 构建的桌面错题整理与练习应用。前端保留 React 和现有绿色界面，桌面端能力、SQLite 数据库、图片/PDF 处理和 AI 请求全部由 Rust 原生实现，不依赖 Electron 或 Node.js sidecar。

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

本地验证包括前端测试、Rust 测试、Clippy、格式化检查、真实旧数据库读取、图片/PDF 选择器、HEIC 解码，以及 macOS `.app` 和 `.dmg` 构建。AI 集成测试使用本地 HTTP mock，不会产生线上模型费用；Windows 构建由 CI 工作流配置，当前开发机未执行 Windows 编译。
