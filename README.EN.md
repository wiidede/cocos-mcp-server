# Cocos Creator MCP Server

[中文](README.md) | [Tool usage](TOOLS.md)

An MCP server for Cocos Creator 3.8.6+. It lets AI clients control scenes, nodes, components, prefabs, assets, and project operations over HTTP.

This project is forked from [DaxianLee/cocos-mcp-server](https://github.com/DaxianLee/cocos-mcp-server) and actively maintains the MCP-to-editor integration.

## Improvements in This Fork

- Uses a unified tool registry with action-specific schemas: each action exposes only its valid parameters, reducing AI guesswork and retries. Clients obtain the live contract from `tools/list`; for complex calls, `tool_registry.describe` provides required fields, examples, and capability status.
- `node_lifecycle.create` can add `components` while creating a node and accepts either `initialTransform` or top-level `position` / `rotation` / `scale` initial transforms.
- Expands and modernizes project, scene, node, component, prefab, and asset management.
- Fixes editor IPC, component-property, and prefab-operation compatibility issues.
- Includes a Dev Test Panel and regression tests for editor integration fixes.

## Install

Place this repository in `extensions/cocos-mcp-server` inside a Cocos project, then run:

```bash
pnpm install
pnpm build
```

Restart Cocos Creator or refresh extensions. Open `Extension > Cocos MCP Server`, then start the server. The default endpoint is `http://127.0.0.1:3000/mcp`.

## Connect a Client

Claude CLI:

```bash
claude mcp add --transport http cocos-creator http://127.0.0.1:3000/mcp
```

Any MCP client supporting HTTP can use:

```json
{
  "mcpServers": {
    "cocos-creator": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

Change the port in the extension panel when needed.

## Calling Tools

Tools use a shared `action` parameter. After connecting, an AI client receives the current tools, actions, and **action-specific** input schemas through MCP `tools/list`; that schema is the source of truth. For complex, infrequent, or failed calls, use `tool_registry.describe` to retrieve allowed and required fields, minimal examples, and capability status for every action.

For example, create a 3D node and attach a component in one call:

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

Do not pass fields belonging to a different action: the schema returns precise parameter guidance before an Editor IPC call is made.

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

Common tools include:

- `scene_management`, `scene_hierarchy`: read, open, and save scenes
- `node_query`, `node_lifecycle`, `node_transform`: inspect and edit nodes
- `component_manage`, `component_query`, `component_property`: manage components and properties
- `prefab_*`, `asset_*`, `project_*`: prefab, asset, and project operations
- `debug_*`: logs, scene trees, and diagnostics

Query UUIDs before write operations: names are not unique. See [TOOLS.md](TOOLS.md) for usage conventions.

## Development

```bash
pnpm watch
pnpm typecheck
pnpm lint
```

The development test panel is available at `Extension > Cocos MCP Server > Dev Test Panel`. Tool implementations are in `source/tools/`; the public registry and schemas are in `source/tools/unified-tools.ts`.

## Requirements

- Cocos Creator 3.8.6 or later
- Node.js bundled with Cocos Creator

## License

This project is for learning, communication, and secondary development only. Commercial use and resale are not permitted; contact the original author for commercial licensing.
