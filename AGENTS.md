# Cocos MCP Server - AGENTS.md

## 项目概述

**Cocos MCP Server** 是一个适用于 Cocos Creator 3.8+ 的综合性 MCP（模型上下文协议）服务器插件。它使 AI 助手（如 Claude、Cursor）能够通过标准化协议与 Cocos Creator 编辑器进行交互，提供 150+ 个工具实现全面的编辑器控制。

## 技术栈

- **语言**: TypeScript
- **运行时**: Node.js（由 Cocos Creator 自带）
- **构建工具**: tsdown (基于 Rolldown)
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

所有工具采用 `类别_操作` 命名模式（如 `scene_get_current_scene`、`node_create_node`），参数采用统一 Schema。

### 主要工具类别

当前版本（v1.4.0）包含 **150+ 个工具**，分布在 14 个类别中：

| 类别               | 主要工具示例                                            | 功能描述     |
| ------------------ | ------------------------------------------------------- | ------------ |
| `scene_*`          | get_current_scene, open_scene, save_scene               | 场景管理     |
| `node_*`           | create_node, get_node_info, set_node_property           | 节点操作     |
| `component_*`      | add_component, remove_component, set_component_property | 组件管理     |
| `prefab_*`         | create_prefab, instantiate_prefab, update_prefab        | 预制体操作   |
| `project_*`        | run_project, build_project, get_project_info            | 项目控制     |
| `debug_*`          | get_console_logs, get_performance_stats, validate_scene | 调试工具     |
| `asset_*`          | import_asset, get_asset_info, get_asset_dependencies    | 资源管理     |
| `preferences_*`    | open_preferences_settings, set_preferences_config       | 偏好设置     |
| `server_*`         | get_server_status, query_server_ip_list                 | 服务器信息   |
| `broadcast_*`      | get_broadcast_log, listen_broadcast                     | 消息广播     |
| `referenceImage_*` | add_reference_image, set_reference_image_opacity        | 参考图片管理 |
| `sceneView_*`      | change_gizmo_tool, focus_camera_on_nodes                | 场景视图控制 |
| `sceneAdvanced_*`  | copy_node, paste_node, execute_component_method         | 高级场景操作 |
| `validation_*`     | validate_json_params, format_mcp_request                | 验证工具     |

### 工具调用示例

```json
{
  "tool": "node_create_node",
  "arguments": {
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
