# Cocos Creator MCP Server

[English](README.EN.md) | [工具使用说明](TOOLS.md)

为 Cocos Creator 3.8.6+ 提供 MCP 服务，让 AI 客户端通过 HTTP 操作场景、节点、组件、预制体、资源和项目。

本项目 Fork 自 [DaxianLee/cocos-mcp-server](https://github.com/DaxianLee/cocos-mcp-server)，持续修复并维护 MCP 工具与 Cocos 编辑器的集成。

## 此 Fork 的改进

- 使用统一工具注册表和 `action` schema，AI 可通过 `tools/list` 获取当前可调用契约。
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

工具使用统一的 `action` 参数。AI 客户端连接后会通过 MCP `tools/list` 自动获取当前工具、操作和参数 schema；这份 schema 是唯一权威来源。

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
