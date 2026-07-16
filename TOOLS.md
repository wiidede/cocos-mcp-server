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
- 不要猜 Cocos Editor message 名称；只调用 `tools/list` 暴露的工具和 action。
- `scene_execution_control.execute_scene_script` 只能调用扩展已注册 scene script 的导出方法，不能执行临时 JavaScript；资源查询、日志读取和场景修改应使用对应的专用工具。
- `scene_undo_manage.begin` 必须通过 `nodeUuid` 或 `nodeUuids` 传入所有需要捕获状态的目标节点；可用 `label` 命名记录，并保存 `data.undoId`，随后传给 `end` 或 `cancel` 配对关闭。
- 资源引用属性应传目标子资源 UUID（例如 SpriteFrame UUID），不要传源图片 UUID；写入失败或验证失败时不要保存场景。
- 创建或打开场景、导入资源后，先确认场景和资源已就绪，再继续使用新 UUID。
- 删除组件前，先通过 `component_query.get_components` 获取组件实例 `uuid`、`componentType` 或 `cid`；删除无 cid 的 `cc.MissingScript` 时使用实例 `uuid`。
- 预制体、资源引用和按钮事件操作前，先读取目标节点及组件状态。
- `prefab_instance.instantiate` 和 `restore` 只有在 `query-nodes-by-asset-uuid` 回读确认关联后才算成功；`restore` 不用于将任意普通节点转换为 Prefab 实例。
- 每次调用检查 `success`；失败时读取 `error` 和 `instruction`，重新查询状态后再重试。
- 扩展重新构建或重载后应重新连接 MCP 客户端以刷新 `tools/list`；现有会话可能继续使用旧的工具 schema。

## 省 Token 规则

- 先用 `tool_registry.actions` 或 `tool_registry.describe` 确认工具，而不是连续试错。
- 查询结果只保留后续写操作需要的 UUID、componentType/cid、asset URL/UUID 和 property path。
- 批量修改前先查询一次状态，再集中执行写操作；不要每改一个字段都重新全量查询。
- 优先使用精确 UUID/URL；只有不知道目标时才用名称、pattern 或 `get_all`。
- 失败后优先按返回的 `instruction` 处理；没有指令时再查 `debug_console` 或 `debug_logs`。

## 常见工作流

### 修改节点 Transform

1. `node_query.find_by_name`、`node_query.find` 或 `scene_hierarchy.get` 找到目标 UUID。
2. `node_transform.set_transform` 写入 `position`、`rotation` 或 `scale`。
3. 需要持久化时调用 `scene_management.save`。

### 修改 Label 文本

1. `node_query` 获取目标 `nodeUuid`。
2. `component_query.get_components` 获取 Label 的实际 `componentType` 或 `cid`。
3. `component_property.set_property` 设置 `property: "string"`。

### 删除组件

1. `component_query.get_components` 查询节点上的组件。
2. 从结果中选择要删除的组件实例 `uuid`（优先）、`componentType` 或 `cid`。
3. `component_manage.remove` 删除组件。

### 绑定 Button 点击事件

1. `node_query` 获取 Button 节点和目标 handler 节点 UUID。
2. `component_query.get_components` 确认 Button 组件存在。
3. `component_event_binding.get_button_events` 读取现有事件。
4. 使用 `append_button_event` 追加，或用 `set_button_events` 全量替换。

### 实例化 Prefab

1. `prefab_browse.list` 或 `asset_query.find_by_name` 找到 prefab。
2. `node_query` 或 `scene_hierarchy` 获取父节点 UUID。
3. `prefab_instance.instantiate` 创建实例。

### 应用或撤销 Prefab 实例改动

1. `node_query` 获取 prefab 实例节点 UUID。
2. 要把实例覆盖写回资源，用 `prefab_edit.update`。
3. 要放弃实例覆盖，用 `prefab_edit.revert`。

### 查找资源引用节点

1. `asset_query.query_uuid`、`asset_query.find_by_name` 或 `asset_query.details` 获取 `assetUuid`。
2. `resource_reference.nodes_by_asset_uuid` 或 `node_reference.nodes_by_asset_uuid` 查找场景节点。

### 诊断失败调用

1. 先读工具返回的 `error` 和 `instruction`。
2. 使用相关 query 工具重新确认目标状态。
3. 如仍无法定位，使用 `debug_console.get` 或 `debug_logs.search` 查编辑器错误。

## 常用入口

- 场景：`scene_management`、`scene_hierarchy`、`scene_query`
- 节点：`node_query`、`node_lifecycle`、`node_transform`、`node_hierarchy`
- 组件：`component_manage`、`component_query`、`component_property`、`component_script`
- 预制体：`prefab_browse`、`prefab_lifecycle`、`prefab_instance`、`prefab_edit`
- 资源：`asset_manage`、`asset_query`、`asset_analyze`
- 项目与调试：`project_manage`、`project_build_system`、`debug_*`

`debug_scene.validate` 只检查场景性能；缺失资源校验应通过资源查询和引用分析完成。
