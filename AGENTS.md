# Cocos MCP Server - AGENTS.md

## 项目概述

**Cocos MCP Server** 是一个适用于 Cocos Creator 3.8+ 的综合性 MCP（模型上下文协议）服务器插件。它使 AI 助手（如 Claude、Cursor）能够通过标准化协议与 Cocos Creator 编辑器进行交互，实现 99% 的编辑器控制。

## 技术栈

- **语言**: TypeScript
- **运行时**: Node.js（由 Cocos Creator 自带）
- **构建工具**: TypeScript 编译器 (`tsc`)
- **依赖库**:
  - `fs-extra`: 文件系统操作
  - `uuid`: UUID 生成
  - `vue@3`: UI 框架
- **编辑器类型**: `@cocos/creator-types/editor`

## 项目结构

```
cocos-mcp-server/
├── source/                    # TypeScript 源代码
│   ├── main.ts               # 插件入口点，定义扩展方法
│   ├── mcp-server.ts         # MCP 服务器核心实现
│   ├── settings.ts           # 设置管理
│   ├── scene.ts              # 场景相关功能
│   ├── types/                # TypeScript 类型定义
│   │   └── index.ts
│   ├── tools/                # 工具实现（50个核心工具）
│   │   ├── scene-tools.ts          # 场景管理
│   │   ├── node-tools.ts           # 节点操作
│   │   ├── component-tools.ts      # 组件操作
│   │   ├── prefab-tools.ts         # 预制体操作
│   │   ├── project-tools.ts       # 项目控制
│   │   ├── debug-tools.ts         # 调试工具
│   │   ├── preferences-tools.ts    # 偏好设置
│   │   ├── server-tools.ts        # 服务器信息
│   │   ├── broadcast-tools.ts      # 消息广播
│   │   ├── scene-advanced-tools.ts # 高级场景工具
│   │   ├── scene-view-tools.ts     # 场景视图控制
│   │   ├── reference-image-tools.ts # 参考图片管理
│   │   ├── asset-advanced-tools.ts # 高级资源工具
│   │   ├── validation-tools.ts     # 验证工具
│   │   └── tool-manager.ts         # 工具管理器
│   ├── panels/               # UI 面板实现
│   │   ├── default/          # 默认面板
│   │   └── tool-manager/     # 工具管理面板
│   └── test/                 # 测试文件
├── dist/                     # 编译后的 JavaScript 输出
├── static/                   # 静态资源（图标、模板、样式）
│   ├── style/default/       # 默认样式
│   └── template/            # HTML 模板
│       ├── default/          # 默认模板
│       └── vue/              # Vue 模板
├── i18n/                     # 国际化文件
│   ├── en.js                 # 英文
│   └── zh.js                 # 中文
├── extension/                # 扩展相关资源
├── @types/                   # 类型定义
│   └── schema/package/      # package.json schema
├── package.json              # 插件配置
├── tsconfig.json             # TypeScript 配置
└── base.tsconfig.json        # 基础 TypeScript 配置
```

## 构建和运行

### 安装依赖

```bash
pnpm install
```

### 构建插件

```bash
# 生产构建
pnpm run build

# 开发构建（监视模式）
pnpm run watch
```

### 构建产物

编译后的 JavaScript 文件输出到 `dist/` 目录。

## 工具体系

### 命名规范

所有工具采用 `类别_操作` 命名模式，参数采用统一 Schema，支持多操作码（action）切换。

### 主要工具类别

| 类别               | 工具数 | 功能描述                                 |
| ------------------ | ------ | ---------------------------------------- |
| `scene_*`          | 3      | 场景管理（获取/打开/保存/新建/关闭场景） |
| `node_*`           | 6      | 节点查询、创建、删除、属性变更           |
| `component_*`      | 4      | 组件增删、脚本挂载、组件信息             |
| `prefab_*`         | 6      | 预制体浏览、创建、实例化、同步           |
| `project_*`        | 2      | 项目运行、构建、配置信息                 |
| `debug_*`          | 3      | 控制台与日志管理                         |
| `asset_*`          | 5      | 资源导入、删除、依赖分析                 |
| `preferences_*`    | 2      | 偏好设置管理                             |
| `server_info`      | 1      | 服务器信息                               |
| `broadcast_*`      | 1      | 消息广播                                 |
| `referenceImage_*` | 2      | 参考图片管理                             |
| `sceneView_*`      | 2      | 场景视图控制                             |
| `validation_*`     | 2      | 场景和资源验证                           |

### 工具调用示例

```json
{
  "tool": "node_lifecycle",
  "arguments": {
    "action": "create",
    "name": "MyNode",
    "parentUuid": "parent-uuid",
    "nodeType": "2DNode"
  }
}
```

## 开发约定

### TypeScript 开发

- 严格类型检查已启用
- 使用 `@cocos/creator-types/editor` 提供编辑器 API 类型
- 开发时可通过 IntelliSense 获取 API 支持

### 添加新工具

1. 在 `source/tools/` 中创建或修改工具类
2. 实现对应的工具方法
3. 工具会自动通过 MCP 协议暴露

### 面板开发

- 使用 Vue 3 Composition API
- 面板配置在 `package.json` 的 `panels` 字段中定义

## 常用命令

### Claude CLI 配置

```bash
claude mcp add --transport http cocos-creator http://127.0.0.1:3000/mcp
```

### Claude 客户端配置

```json
{
  "mcpServers": {
    "cocos-creator": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

### Cursor/VSCode MCP 配置

```json
{
  "mcpServers": {
    "cocos-creator": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## 系统要求

- Cocos Creator 3.8.6 或更高版本
- Node.js（Cocos Creator 自带）

## 相关文档

- [功能指南中文版](./FEATURE_GUIDE_CN.md)
- [功能指南英文版](./FEATURE_GUIDE_EN.md)
- [README](./README.md)
