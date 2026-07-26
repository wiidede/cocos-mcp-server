# Cocos Creator MCP Server

[English](README.EN.md) | [工具使用说明](TOOLS.md)

为 Cocos Creator 3.8.6+ 提供 MCP 服务，让 AI 客户端通过 HTTP 操作场景、节点、组件、预制体、资源和项目。

本项目 Fork 自 [DaxianLee/cocos-mcp-server](https://github.com/DaxianLee/cocos-mcp-server)，持续修复并维护 MCP 工具与 Cocos 编辑器的集成。

## 此 Fork 的改进

- 使用统一工具注册表和 action-specific schema；每个 action 只公开其允许参数，减少 AI 猜测字段和试错。AI 可通过 `tools/list` 获取当前可调用契约，并在复杂调用前使用 `tool_registry.describe` 获取必填字段、示例和能力状态。
- `node_lifecycle.create` 支持创建节点时附加 `components`，以及 `initialTransform` 或顶层 `position` / `rotation` / `scale` 初始变换。
- 补全并现代化项目、场景、节点、组件、预制体和资源管理能力。
- 修复多项编辑器 IPC、组件属性和预制体操作的兼容性问题。
- 提供 Dev Test Panel 与回归测试，防止已修复的编辑器集成问题再次出现。

## 安装

将此仓库放入 Cocos 项目的 `extensions/cocos-mcp-server`，然后执行：

```bash
pnpm install
pnpm build
```

重启 Cocos Creator 或刷新扩展，在 `扩展 > Cocos MCP Server` 打开面板并启动服务。默认地址为 `http://127.0.0.1:3000/mcp`。

## 连接客户端

Claude CLI：

```bash
claude mcp add --transport http cocos-creator http://127.0.0.1:3000/mcp
```

兼容 MCP HTTP 的客户端可使用：

```json
{
  "mcpServers": {
    "cocos-creator": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

端口可在扩展面板中修改。

## 工具调用

工具使用统一的 `action` 参数。AI 客户端连接后会通过 MCP `tools/list` 自动获取当前工具、操作和 **action-specific** 参数 schema；这份 schema 是唯一权威来源。复杂、低频或调用失败后，可使用 `tool_registry.describe` 查询某个工具中每个 action 的允许字段、必填字段、最小示例和能力状态。

例如创建 3D 节点并直接添加组件：

```json
{
  "name": "node_lifecycle",
  "arguments": {
    "action": "create",
    "name": "MeshNode",
    "nodeType": "3DNode",
    "components": ["cc.MeshRenderer"],
    "position": { "x": 0, "y": 1, "z": 0 }
  }
}
```

不要为一个 action 传入其他 action 的字段；schema 会在调用 Editor IPC 前返回精确的参数提示。

```json
{
  "name": "node_lifecycle",
  "arguments": {
    "action": "create",
    "name": "Player",
    "parentUuid": "parent-uuid",
    "nodeType": "2DNode"
  }
}
```

常见工具包括：

- `scene_management`、`scene_hierarchy`：场景读取、打开和保存
- `node_query`、`node_lifecycle`、`node_transform`：节点查询和编辑
- `component_manage`、`component_query`、`component_property`：组件管理和属性设置
- `prefab_*`、`asset_*`、`project_*`：预制体、资源和项目操作
- `debug_*`：日志、场景树和诊断

执行写操作前先查询 UUID；名称不是唯一标识。更多调用约定见 [TOOLS.md](TOOLS.md)。

## 开发

```bash
pnpm watch
pnpm typecheck
pnpm lint
```

开发测试面板位于 `扩展 > Cocos MCP Server > Dev Test Panel`。核心实现位于 `source/tools/`，工具注册和公开 schema 位于 `source/tools/unified-tools.ts`。

## 兼容性

- Cocos Creator 3.8.6 或更高版本
- Node.js（由 Cocos Creator 提供）

## 许可证

本项目仅供学习、交流和二次开发；不得用于商业用途或转售。商业使用请联系原作者。
