# Cocos MCP Server 发布包构建计划

## 实施状态

已完成：构建配置、面板静态资源路径、第三方依赖打包、`cocos-mcp-server-pkg/` 发布目录生成脚本和基于 Tag 的 GitHub Release Workflow 均已落地。

## 目标

生成一个可以直接复制到 Cocos Creator `extensions/` 目录的发布包，不携带 `node_modules`、TypeScript 源码或开发工具配置。

运行时只使用宿主提供的依赖：

- Cocos Creator 的 `Editor` 全局对象；
- Cocos Creator 提供的 `cc` 模块；
- Node.js 内置模块，例如 `node:fs`、`node:path` 和 `node:http`。

第三方运行时依赖 Vue 将被打包进面板 CJS 文件。

## 最终发布结构

```text
cocos-mcp-server-pkg/
├── package.json
├── README.md
├── README.EN.md
├── i18n/
│   ├── en.js
│   └── zh.js
└── dist/
    ├── main.cjs
    ├── scene.cjs
    ├── static/
    │   ├── template/
    │   └── style/
    └── panels/
        ├── default/index.cjs
        ├── dev-test/index.cjs
        └── tool-manager/index.cjs
```

`package.json` 和 `i18n/` 保留在扩展根目录：前者是 Cocos 扩展清单，后者使用 Cocos 扩展约定的本地化加载位置。静态资源统一收进 `dist/static/`。

## 实施步骤

### 1. 消除 `fs-extra` 运行时依赖

三个面板只使用了 `readFileSync`，统一改为从 `node:fs` 导入，并移除 `fs-extra` 和 `@types/fs-extra`。

### 2. 打包 Vue

更新 tsdown 配置，让 `vue` 始终进入面板 CJS bundle，同时继续将 `cc` 标记为外部模块。Node 内置模块保持外部模块，不尝试打包。所有 CJS 输出统一开启 `minify`，减少发布包体积。

构建产物中不应再出现：

```text
require("vue")
require("fs-extra")
```

允许出现：

```text
require("cc")
require("node:...")
```

### 3. 统一静态资源路径

编译后的面板位于 `dist/panels/<panel>/index.cjs`，静态资源位于 `dist/static/`。面板使用：

```ts
const staticDir = join(__dirname, '../../static')
```

所有模板和样式通过 `staticDir` 读取，避免依赖发布包根目录下的 `static/`。

### 4. 由一个发布脚本生成完整发布包

新增 `scripts/create-release.mjs`，负责全部发布准备工作：

1. 清理旧的 `cocos-mcp-server-pkg/`；
2. 将根目录 `static/` 复制到 `dist/static/`，确保本地构建产物也能直接运行；
3. 将完整的 `dist/` 复制到发布目录；
4. 复制 `i18n/`、`README.md` 和 `README.EN.md`；
5. 从根目录 `package.json` 生成发布版清单；
6. 删除发布版中的 `$schema`、scripts、dependencies、devDependencies 和 `packageManager`；
7. 将 `files` 设置为发布包实际包含的目录；
8. 写入 `cocos-mcp-server-pkg/package.json`。

该脚本只使用 Node.js 内置模块，不新增发布依赖。

`pnpm build` 在 tsdown 构建后执行该脚本，使 `dist/` 和 `cocos-mcp-server-pkg/` 同时保持可用。

### 5. 更新 Cocos 清单路径

面板入口和 scene 入口继续指向 `dist/` 下的 CJS 文件。面板不再配置自定义图标，使用 Cocos Creator 的默认面板图标。

根目录清单用于本地调试，发布脚本生成的清单用于最终交付；发布版清单不携带任何 npm 运行时依赖。

### 6. 配置版本发布

使用 `pnpm release` 先执行 lint、类型检查和构建，再由 `bumpp` 完成版本号、release commit 和 `v*` Tag 的创建与推送：

```bash
pnpm release
```

推送 `v*` Tag 后，`.github/workflows/release.yml` 自动执行：

1. 安装锁定的 pnpm 依赖；
2. 执行 `pnpm build` 生成 `cocos-mcp-server-pkg/`；
3. 将发布包压缩为 `cocos-mcp-server-v<version>.zip`；
4. 使用 `changelogithub` 生成 GitHub Release Notes；
5. 将 ZIP 作为 Release Asset 上传。

项目不维护 `CHANGELOG.md`，也不添加 changelogithub 配置文件；变更记录只存在于 GitHub Release 页面。

### 7. 校验发布包

完成构建后执行：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- 检查 `dist/**/*.cjs` 中的外部 require；
- 检查发布包中没有 `node_modules/`、`source/` 和开发配置；
- 检查发布包中的 CJS、静态资源、i18n 和 package manifest 均存在。

开发环境可在 Cocos Creator 中通过 Developer Import 直接引用 `cocos-mcp-server-pkg/`；非开发环境可将 GitHub Release 下载的 ZIP 解压到项目的 `extensions/cocos-mcp-server/` 下运行。

## 验收标准

- [x] 发布包不包含 `node_modules`；
- 发布包不需要执行 `pnpm install`；
- 面板 CJS 不再 require `vue`、`fs-extra` 等第三方模块；
- `cc` 仍由 Cocos Creator 提供，不被错误打包；
- default、dev-test、tool-manager 三个面板的 HTML/CSS 可以读取；
- i18n、main、scene 和 panel 入口均有效；
- 本地 `dist/` 和最终 `cocos-mcp-server-pkg/` 使用同一套构建产物。
