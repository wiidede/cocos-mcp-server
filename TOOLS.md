# 工具使用说明

MCP 客户端应以 `tools/list` 返回的名称、描述和 input schema 为准。本文件只说明稳定的调用原则，不重复维护完整参数表。

## 调用格式

所有公开工具使用 `action` 区分操作：

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

不确定工具、操作或参数时，优先查看 MCP 的 `tools/list`；也可以使用 `tool_registry` 的 `list`、`actions` 和 `describe` 操作。

## 调用原则

- 先查询再修改：场景用 `scene_hierarchy`，节点用 `node_query`，组件用 `component_query`，资源用 `asset_query` 或 `project_query`。
- 写操作使用 UUID、`nodeUuid`、`assetUuid` 和 `prefabPath`；名称仅适合搜索，且不保证唯一。
- 创建或打开场景、导入资源后，先确认场景和资源已就绪，再继续使用新 UUID。
- 删除组件前，先通过 `component_query.get_components` 获取实际 `componentType` 或 `cid`。
- 预制体、资源引用和按钮事件操作前，先读取目标节点及组件状态。
- 每次调用检查 `success`；失败时读取 `error`，重新查询状态后再重试。

## 常用入口

- 场景：`scene_management`、`scene_hierarchy`、`scene_query`
- 节点：`node_query`、`node_lifecycle`、`node_transform`、`node_hierarchy`
- 组件：`component_manage`、`component_query`、`component_property`、`component_script`
- 预制体：`prefab_browse`、`prefab_lifecycle`、`prefab_instance`、`prefab_edit`
- 资源：`asset_manage`、`asset_query`、`asset_analyze`
- 项目与调试：`project_manage`、`project_build_system`、`debug_*`

`debug_scene.validate` 只检查场景性能；缺失资源校验应通过资源查询和引用分析完成。
