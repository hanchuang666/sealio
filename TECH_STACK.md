# Sealio 技术栈说明

本文档用于说明 Sealio 图章工具当前项目中使用到的前端、后端、桌面端、部署与相关插件/辅助工具技术栈，方便后续开发、部署和维护时快速理解项目边界。

## 项目概览

Sealio 是一个用于 PDF / 图片加盖图章的工具，目前同时支持：

- **桌面客户端**：基于 Tauri 打包为 macOS / Windows 应用。
- **网页版客户端**：基于同一套 React 前端构建后部署到服务器，通过浏览器访问。
- **后端服务**：提供网页版所需的图章上传、临时文件上传、图章静态访问和健康检查接口。

项目的核心原则是：**同一个功能在 Web、桌面端等客户端中应保持一致的交互与能力，前端通过统一适配层屏蔽不同端的底层差异。**

## 前端技术栈

| 类型 | 技术 | 用途 |
| --- | --- | --- |
| UI 框架 | React 18 | 构建主界面、状态管理和交互逻辑。 |
| 语言 | TypeScript 5 | 提供类型约束，降低多端适配时的错误风险。 |
| 构建工具 | Vite 4 | 本地开发、生产构建和资源拆包。 |
| 样式 | 原生 CSS | 项目主样式位于 `src/styles.css`。 |
| PDF 渲染 | `pdfjs-dist` | 将 PDF 页面渲染为 Canvas / 图片预览。 |
| PDF 导出 | `pdf-lib` | 在 PDF 上写入图章并导出新文件。 |
| 桌面 API 适配 | `@tauri-apps/api` | 在 Tauri 桌面端调用原生命令、窗口事件、文件资源地址转换。 |

### 前端关键文件

- `src/main.tsx`：主应用入口，负责界面状态、图章放置和交互编排。
- `src/types.ts`：文档、页面、图章和放置数据的共享类型。
- `src/media.ts`：图片、Canvas、Blob URL 的创建与资源释放工具。
- `src/document-renderer.ts`：按需加载 PDF.js 并生成文档页面预览。
- `src/document-exporter.ts`：按需加载 PDF-lib，负责 PDF 和图片导出。
- `src/native.ts`：多端适配层，统一封装 Web 与 Tauri 桌面端差异。
- `src/styles.css`：应用整体样式，包括图章列表、加载状态、编辑区、弹窗等。
- `vite.config.ts`：Vite 构建配置。
- `tsconfig.json`：TypeScript 配置。

### 前端性能策略

- PDF 相关库采用动态加载，避免首屏一次性下载完整 PDF 引擎。
- React 运行时拆为稳定缓存块，频繁发布时浏览器无需重复下载未变化的框架代码。
- PDF 页面预览使用 Blob URL，关闭文件或退出时主动释放，避免 Base64 占用额外内存。
- 图章列表采用“先加载元数据，再懒加载图片”的方式，避免大量图章阻塞页面显示。
- 图章真实 bytes 在导出时按需读取，并在导出过程中缓存，避免同一图章重复下载或读取。
- PDF 导出复用已嵌入的图章对象，图片导出复用已解码图片，降低重复处理和输出体积。
- `npm run build` 会执行产物体积预算检查，阻止异常膨胀进入发布流程。

## 多端适配层

多端一致性的核心在 `src/native.ts`。

该文件将不同运行环境包装成统一的 `sealio` API：

| API | Web 实现 | Tauri 桌面端实现 |
| --- | --- | --- |
| `openDocument` | 浏览器文件选择器 | Tauri 原生命令 `open_document` |
| `openDocumentFiles` | 浏览器拖拽文件读取，并上传临时文件 | 桌面端主要走路径打开 |
| `uploadStamp` | `POST /api/stamps` 上传图章 | Tauri 原生命令 `upload_stamp` |
| `listStamps` | `GET /api/stamps` 获取图章元数据 | Tauri 原生命令 `list_stamps` |
| `readStamp` | 通过图章 URL 读取 bytes | Tauri 原生命令 `read_stamp` |
| `writeExport` | 浏览器下载文件 | Tauri 原生命令写入本地文件 |

后续新增功能时，应优先在 `src/native.ts` 中定义统一接口，再分别补齐 Web / Tauri 的实现，避免某个客户端功能缺失。

## 桌面端技术栈

| 类型 | 技术 | 用途 |
| --- | --- | --- |
| 桌面框架 | Tauri 2 | 将 React 前端封装为跨平台桌面应用。 |
| 原生语言 | Rust 2021 | 实现本地文件读写、图章历史、导出路径选择等能力。 |
| 文件选择 | `rfd` | 打开文件、选择图章、选择导出路径。 |
| 序列化 | `serde` / `serde_json` | 前端与 Rust 命令之间传递结构化数据。 |
| ID 生成 | `uuid` | 生成图章 ID。 |
| 构建插件 | `tauri-build` | Tauri 构建期集成。 |

### 桌面端关键文件

- `src-tauri/src/lib.rs`：Tauri 原生命令实现。
- `src-tauri/src/main.rs`：桌面应用入口。
- `src-tauri/tauri.conf.json`：Tauri 主配置，包含窗口、打包、图标等配置。
- `src-tauri/tauri.windows.conf.json`：Windows NSIS 打包配置。
- `src-tauri/capabilities/default.json`：Tauri 权限配置。
- `src-tauri/Cargo.toml`：Rust 依赖与 release 优化配置。

### Tauri 原生命令

当前主要命令包括：

- `open_document`：打开 PDF / 图片文件。
- `open_document_paths`：根据路径打开文件。
- `upload_stamp`：导入图章并保存到本地历史。
- `list_stamps`：列出本地图章元数据。
- `read_stamp`：按图章 ID 读取图章 bytes。
- `pick_export_path`：选择导出路径。
- `write_export`：写入导出文件并在文件夹中显示。

## 后端技术栈

| 类型 | 技术 | 用途 |
| --- | --- | --- |
| 语言 | Python 3 | 实现轻量后端 API。 |
| HTTP 服务 | Python 标准库 `http.server` | 提供 API 路由，无额外 Web 框架依赖。 |
| 并发模型 | `ThreadingMixIn` | 支持多请求并发处理。 |
| 文件上传 | `cgi.FieldStorage` | 处理 `multipart/form-data` 上传。 |
| 数据存储 | 本地文件系统 + JSON | 图章文件、临时文件和图章索引持久化。 |

### 后端关键文件

- `server/sealio_backend.py`：后端 API 服务。
- `deploy/sealio-backend.service`：systemd 服务配置。
- `deploy/nginx-sealio.conf`：Nginx 反向代理与静态资源配置模板。

### 后端接口

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/api/health` | `GET` | 健康检查。 |
| `/api/stamps` | `GET` | 获取图章元数据列表。 |
| `/api/stamps` | `POST` | 上传图章文件。 |
| `/api/uploads` | `POST` | 上传临时处理文件。 |
| `/files/stamps/<file>` | `GET` | 图章静态访问；生产环境由 Nginx 承接。 |
| `/files/uploads/<file>` | `GET` | 临时文件静态访问；生产环境由 Nginx 承接。 |

### 后端数据目录

本地开发默认写入仓库根目录的 `.sealio-data`；systemd 部署模板会把 `SEALIO_DATA_DIR` 设置为 `/var/lib/sealio`：

- `/var/lib/sealio/stamps`：持久化图章图片。
- `/var/lib/sealio/uploads`：临时上传文件。
- `/var/lib/sealio/stamps.json`：图章元数据索引。

后端支持的环境变量：

- `SEALIO_HOST`：监听地址，部署中默认为 `127.0.0.1`。
- `SEALIO_PORT`：监听端口，部署中默认为 `8081`。
- `SEALIO_DATA_DIR`：数据目录，部署中默认为 `/var/lib/sealio`。
- `SEALIO_MAX_UPLOAD_BYTES`：最大上传大小。
- `SEALIO_UPLOAD_TTL_SECONDS`：临时上传文件保留时间。
- `SEALIO_UPLOAD_CLEANUP_INTERVAL_SECONDS`：临时文件目录清理检查间隔，默认 60 秒。

## 部署技术栈

| 类型 | 技术 | 用途 |
| --- | --- | --- |
| Web 服务器 | Nginx | 托管 React 静态资源，反向代理后端 API。 |
| 服务管理 | systemd | 管理 Python 后端常驻运行。 |
| 构建产物 | Vite `dist/` | Web 端部署目录内容来源。 |
| 服务器数据 | 本地文件系统 | 保存图章与临时上传文件。 |

### 线上部署结构

当前服务器部署方案大致为：

- React 构建产物部署到 `/var/www/sealio`。
- Python 后端部署到 `/opt/sealio/backend/sealio_backend.py`。
- systemd 服务名为 `sealio-backend`。
- Nginx 监听 80 端口，对外提供 `http://服务器IP/`。
- `/api/` 请求反向代理到 `127.0.0.1:8081`。
- `/files/stamps/` 和 `/files/uploads/` 由 Nginx 直接读取本地文件目录。

## 打包与发布技术栈

| 平台 | 技术 | 说明 |
| --- | --- | --- |
| macOS | Tauri + shell + `hdiutil` | `scripts/package-mac-tauri.sh` 生成 DMG。 |
| Windows | Tauri NSIS | `npm run package:windows` 生成 Windows 安装包。 |
| CI | GitHub Actions | `.github/workflows/windows-build.yml` 自动构建 Windows 安装包。 |
| Web 自动部署 | GitHub Actions + SSH | `.github/workflows/deploy-server.yml` 在 push 后构建 Web 产物并部署到服务器。 |
| Node 环境 | Node.js 20 | GitHub Actions 中使用 Node 20。 |
| Rust 环境 | stable Rust | GitHub Actions 中使用 `dtolnay/rust-toolchain@stable`。 |

### 常用命令

```bash
npm run dev          # 启动 Tauri 桌面开发模式
npm run dev:backend  # 启动 Web 本地开发后端（数据写入 .sealio-data）
npm run dev:vite     # 仅启动 Vite 前端开发服务
npm run build        # TypeScript 检查并构建 Web 产物
npm run preview      # 预览 Vite 构建产物
npm run package:mac  # 本地生成 macOS DMG
npm run package:windows  # 生成 Windows NSIS 安装包
```

Rust 检查命令：

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo check --manifest-path src-tauri/Cargo.toml
```

## 插件与辅助工具

### 项目运行时插件 / 依赖

当前项目没有引入复杂的前端插件体系，主要依赖如下：

- `@vitejs/plugin-react`：Vite React 插件，用于 React 编译支持。
- `@tauri-apps/api`：前端调用 Tauri 能力的 API 包。
- `tauri-build`：Rust 构建期 Tauri 集成。
- `rfd`：Rust 文件选择对话框库。

### Codex 辅助技能

在当前开发环境中，和本项目相关的 Codex skill 包括：

- `sealio-package-release`：用于 Sealio 打包发布流程，例如 macOS DMG、本地提交、GitHub Actions Windows 包验证等。
- `browser` / `chrome`：用于需要浏览器调试或页面检查的场景。
- `pdf`：用于需要深入检查 PDF 渲染或导出结果的场景。

这些 Codex skill 属于开发辅助能力，不是应用运行时依赖，也不会被打包进 Sealio 客户端。

## 外部集成说明

此前服务器上还配置过 QQ 机器人到 Codex 的桥接服务，用于通过 QQ 对话触发服务器上的 Codex 操作。该桥接服务当前不属于本仓库源码的一部分，属于服务器侧外部运维集成。

如果后续要把该能力纳入项目源码，建议单独放到类似 `integrations/qq-codex-bridge/` 的目录，并补充：

- 服务端源码。
- systemd 服务文件。
- 环境变量模板。
- 安全策略与授权说明。

## 多端一致开发约定

后续新增或修改功能时，建议遵守以下约定：

1. **先定义统一前端接口**：优先在 `src/native.ts` 中定义客户端能力，例如读取文件、上传图章、读取图章 bytes。
2. **再分别实现各端能力**：Web 走 HTTP API / 浏览器能力，Tauri 走原生命令。
3. **UI 体验保持一致**：加载状态、错误提示、上传逻辑、导出逻辑应尽量复用同一套 React 组件和状态。
4. **大文件按需加载**：PDF 引擎、图章图片、图章 bytes 等应避免首屏一次性加载。
5. **后端只做 Web 必需能力**：桌面端本地文件能力优先走 Tauri，Web 端需要持久化或临时处理时再走 Python 后端。
6. **部署配置与源码同步维护**：Nginx、systemd、后端环境变量变化时，应同步更新 `deploy/` 目录和本文档。

## 当前重要文件索引

```text
.
├── src/
│   ├── main.tsx              # React 主应用与交互编排
│   ├── types.ts              # 共享领域类型
│   ├── media.ts              # 图片、Canvas 与资源生命周期
│   ├── document-renderer.ts  # 文档预览渲染
│   ├── document-exporter.ts  # PDF / 图片导出
│   ├── native.ts             # Web / Tauri 多端适配层
│   └── styles.css            # 应用样式
├── src-tauri/
│   ├── src/lib.rs            # Tauri 原生命令
│   ├── src/main.rs           # 桌面入口
│   ├── tauri.conf.json       # Tauri 主配置
│   └── Cargo.toml            # Rust 依赖
├── server/
│   └── sealio_backend.py     # Web 后端 API
├── deploy/
│   ├── nginx-sealio.conf     # Nginx 配置模板
│   └── sealio-backend.service # systemd 服务模板
├── scripts/
│   ├── check-bundle-size.mjs # Web 产物体积预算检查
│   └── package-mac-tauri.sh  # macOS 打包脚本
├── .github/workflows/
│   ├── windows-build.yml     # Windows 构建 CI
│   └── deploy-server.yml     # Web 服务器自动部署 CI
├── package.json              # Node / 前端依赖和命令
└── TECH_STACK.md             # 本文档
```
