# Cocos Creator MCP Server

[中文](README.md) | [Tool usage](TOOLS.md)

An MCP server for Cocos Creator 3.8.6+. It lets AI clients control scenes, nodes, components, prefabs, assets, and project operations over HTTP.

This project is forked from [DaxianLee/cocos-mcp-server](https://github.com/DaxianLee/cocos-mcp-server) and actively maintains the MCP-to-editor integration.

## v2.0 Highlights

- Supports legacy MCP `2024-11-05` and modern MCP `2026-07-28` on the same `/mcp` endpoint. The modern transport provides `server/discover`, per-request `_meta`, HTTP routing-header validation, `resultType`, and `structuredContent`, while existing clients may continue to use `initialize`.
- Uses a unified tool registry with action-specific schemas, so every action exposes only valid parameters. Clients obtain live contracts from `tools/list`; `tool_registry.describe` provides required fields, minimal examples, deprecation status, and capability status.
- Provides stable machine-readable error codes and attempted/allowed context for contract failures, enabling clients to correct requests without parsing error prose.
- Consolidates asset APIs around `asset_query.resolve_identity`, which resolves an asset URL, UUID, and filesystem path in one call. Legacy conversion actions remain compatible but are deprecated. Asset imports support explicit `overwrite` behavior and safe conflict guidance.
- Hides duplicate legacy public wrappers and unavailable actions while retaining direct-call compatibility, reducing `tools/list` noise and accidental calls.
- `node_lifecycle.create` can attach `components` while creating a node and accepts either `initialTransform` or top-level `position` / `rotation` / `scale` values.
- Expands project, scene, node, component, prefab, and asset management while fixing editor IPC, component-property, and prefab-operation compatibility issues.
- Includes a Dev Test Panel, dispatcher contract tests, and dual-era protocol fixtures to protect the MCP-to-editor integration from regressions.

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

The server supports both legacy `2024-11-05` and modern `2026-07-28`. Legacy clients continue to use `initialize`; modern clients use per-request `_meta` plus matching `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` HTTP headers, and may call `server/discover` first. Modern tool results include both `structuredContent` and backwards-compatible serialized JSON text.

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
