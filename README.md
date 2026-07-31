# Cocos Creator MCP Server

[English](README.EN.md) | [工具使用说明](TOOLS.md)

为 Cocos Creator 3.8.6+ 提供 MCP 服务，让 AI 客户端通过 HTTP 操作场景、节点、组件、预制体、资源和项目。

本项目 Fork 自 [DaxianLee/cocos-mcp-server](https://github.com/DaxianLee/cocos-mcp-server)，持续修复并维护 MCP 工具与 Cocos 编辑器的集成。

## v2.0 主要特性

- 同一 `/mcp` endpoint 同时支持 legacy MCP `2024-11-05` 和 modern MCP `2026-07-28`。modern transport 提供 `server/discover`、逐请求 `_meta`、HTTP routing header 校验、`resultType` 与 `structuredContent`，旧客户端仍可使用 `initialize`。
- 使用统一工具注册表和 action-specific schema；每个 action 只公开允许参数。客户端可通过 `tools/list` 获取实时契约，通过 `tool_registry.describe` 查询必填字段、最小示例、deprecated 状态和能力状态。
- 统一工具和 action 命名规则，按“领域 + 能力”组织公开 API，并优先使用 `get`、`list`、`find`、`check`、`set` 等明确语义。减少重复 wrapper、模糊的 `manage` / `query_*` 名称和重复 action，帮助 AI 客户端更快选择正确的工具与操作，提高首次调用成功率。
- 提供稳定的机器错误码，并在契约错误中返回 attempted/allowed 上下文，便于客户端自动修正参数，而不是依赖错误文本。
- 收敛资源 API：推荐使用 `asset_query.resolve_identity` 一次解析 URL、UUID 和文件系统路径；旧转换 action 保持兼容但标记 deprecated。资源导入支持显式 `overwrite` 和安全冲突提示。
- 隐藏重复的 legacy public wrapper 和当前不可用 action，直接调用兼容路径仍然保留，减少 `tools/list` 噪音和误调用。
- `node_lifecycle.create` 支持创建节点时附加 `components`，以及 `initialTransform` 或顶层 `position` / `rotation` / `scale` 初始变换。
- 补全并现代化项目、场景、节点、组件、预制体和资源管理能力，并修复多项编辑器 IPC、组件属性和预制体操作兼容性问题。
- 提供 Dev Test Panel、dispatcher 契约测试和双时代协议 fixture，防止工具与编辑器集成回归。

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

服务端同时支持 legacy `2024-11-05` 和 modern `2026-07-28`：旧客户端继续使用 `initialize`；modern 客户端使用每请求 `_meta` 和对应的 `MCP-Protocol-Version`、`Mcp-Method`、`Mcp-Name` HTTP headers，并可先调用 `server/discover`。modern 工具结果同时返回 `structuredContent` 和兼容的 JSON 文本。

## 工具调用

工具使用统一的 `action` 参数。AI 客户端连接后会通过 MCP `tools/list` 自动获取当前工具、操作和 **action-specific** 参数 schema；这份 schema 是唯一权威来源。规范化的工具名称和 action 名称会把领域、能力和操作语义直接表达出来，例如：

- `scene_lifecycle.get_current`：获取当前场景
- `scene_hierarchy.get_tree`：读取场景层级
- `node_query.find`：按条件查找节点
- `component_query.list`：列出节点组件
- `asset_query.resolve_identity`：解析资源身份

因此，工具名称规范化、明确的 action 命名、严格的 action-specific schema 和实时 `tools/list` 会共同降低工具选错、action 拼错以及参数串用的概率。它们改善的是模型选择工具和生成参数的成功率；协议版本协商、HTTP endpoint 和 MCP adapter 负责的是请求能否正常连接到服务端，两者属于不同层次。

复杂、低频或调用失败后，可使用 `tool_registry.describe` 查询某个工具中每个 action 的允许字段、必填字段、最小示例和能力状态。

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

- `scene_lifecycle`、`scene_hierarchy`：场景生命周期和层级读取
- `node_query`、`node_lifecycle`、`node_property`：节点查询、创建和属性编辑
- `component_lifecycle`、`component_query`、`component_property`：组件管理、查询和属性设置
- `prefab_query`、`prefab_lifecycle`、`prefab_instance`、`asset_query`、`asset_lifecycle`：预制体和资源操作
- `project_query`、`project_build`、`debug_*`：项目管理、构建和诊断

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

## 授权说明

本项目基于原项目 fork，为非官方版本，仅供学习、交流和个人非商业使用。不得用于商业用途或转售；商业使用请联系原作者。
