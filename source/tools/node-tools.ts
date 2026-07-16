import type { SceneComponentDump, SceneNodeDump } from '../editor-message'
import type { NodeInfo, ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import { requestScene } from '../editor-message'
import { getComponentType } from './component-query'
import { ComponentTools } from './component-tools'
import { is2DNodeInfo, normalizeNodeDumpValue, normalizeTransformValue as normalizeNodeTransformValue } from './node-value'
import { toolFailure } from './tool-response'

type ToolArguments = Record<string, unknown>

interface NodeTransformInput extends ToolArguments {
  uuid: string
  position?: unknown
  rotation?: unknown
  scale?: unknown
}

interface CreateNodeInput extends ToolArguments {
  name: string
  parentUuid?: string
  nodeType?: string
  components?: string[]
  assetUuid?: string
  assetPath?: string
  unlinkPrefab?: boolean
  keepWorldTransform?: boolean
  siblingIndex?: number
  initialTransform?: Omit<NodeTransformInput, 'uuid'>
}

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class NodeTools implements ToolExecutor {
  private componentTools = new ComponentTools()
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'create_node',
        description: 'Create a new node in the scene. Supports creating empty nodes, nodes with components, or instantiating from assets (prefabs, etc.). IMPORTANT: You should always provide parentUuid to specify where to create the node.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Node name',
            },
            parentUuid: {
              type: 'string',
              description: 'Parent node UUID. STRONGLY RECOMMENDED: Always provide this parameter. Use get_current_scene or get_all_nodes to find parent UUIDs. If not provided, node will be created at scene root.',
            },
            nodeType: {
              type: 'string',
              description: 'Node type: Node, 2DNode, 3DNode',
              enum: ['Node', '2DNode', '3DNode'],
              default: 'Node',
            },
            siblingIndex: {
              type: 'number',
              description: 'Sibling index for ordering (-1 means append at end)',
              default: -1,
            },
            assetUuid: {
              type: 'string',
              description: 'Asset UUID to instantiate from (e.g., prefab UUID). When provided, creates a node instance from the asset instead of an empty node.',
            },
            assetPath: {
              type: 'string',
              description: 'Asset path to instantiate from (e.g., "db://assets/prefabs/MyPrefab.prefab"). Alternative to assetUuid.',
            },
            components: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of component type names to add to the new node (e.g., ["cc.Sprite", "cc.Button"])',
            },
            unlinkPrefab: {
              type: 'boolean',
              description: 'If true and creating from prefab, unlink from prefab to create a regular node',
              default: false,
            },
            keepWorldTransform: {
              type: 'boolean',
              description: 'Whether to keep world transform when creating the node',
              default: false,
            },
            initialTransform: {
              type: 'object',
              properties: {
                position: {
                  type: 'object',
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                    z: { type: 'number' },
                  },
                },
                rotation: {
                  type: 'object',
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                    z: { type: 'number' },
                  },
                },
                scale: {
                  type: 'object',
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                    z: { type: 'number' },
                  },
                },
              },
              description: 'Initial transform to apply to the created node',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'get_node_info',
        description: 'Get node information by UUID',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Node UUID',
            },
          },
          required: ['uuid'],
        },
      },
      {
        name: 'find_nodes',
        description: 'Find nodes by name pattern',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Name pattern to search',
            },
            exactMatch: {
              type: 'boolean',
              description: 'Exact match or partial match',
              default: false,
            },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'find_node_by_name',
        description: 'Find first node by exact name',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Node name to find',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'get_all_nodes',
        description: 'Get all nodes in the scene with their UUIDs',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'set_node_property',
        description: 'Set node property value (prefer using set_node_transform for active/layer/mobility/position/rotation/scale)',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Node UUID',
            },
            property: {
              type: 'string',
              description: 'Property name (e.g., active, name, layer)',
            },
            value: {
              description: 'Property value',
            },
          },
          required: ['uuid', 'property', 'value'],
        },
      },
      {
        name: 'set_node_transform',
        description: 'Set node transform properties (position, rotation, scale) with unified interface. Automatically handles 2D/3D node differences.',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Node UUID',
            },
            position: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                z: { type: 'number', description: 'Z coordinate (ignored for 2D nodes)' },
              },
              description: 'Node position. For 2D nodes, only x,y are used; z is ignored. For 3D nodes, all coordinates are used.',
            },
            rotation: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'X rotation (ignored for 2D nodes)' },
                y: { type: 'number', description: 'Y rotation (ignored for 2D nodes)' },
                z: { type: 'number', description: 'Z rotation (main rotation axis for 2D nodes)' },
              },
              description: 'Node rotation in euler angles. For 2D nodes, only z rotation is used. For 3D nodes, all axes are used.',
            },
            scale: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                z: { type: 'number', description: 'Z scale (usually 1 for 2D nodes)' },
              },
              description: 'Node scale. For 2D nodes, z is typically 1. For 3D nodes, all axes are used.',
            },
          },
          required: ['uuid'],
        },
      },
      {
        name: 'delete_node',
        description: 'Delete a node from scene',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Node UUID to delete',
            },
          },
          required: ['uuid'],
        },
      },
      {
        name: 'move_node',
        description: 'Move node to new parent',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Node UUID to move',
            },
            newParentUuid: {
              type: 'string',
              description: 'New parent node UUID',
            },
            siblingIndex: {
              type: 'number',
              description: 'Sibling index in new parent',
              default: -1,
            },
          },
          required: ['nodeUuid', 'newParentUuid'],
        },
      },
      {
        name: 'duplicate_node',
        description: 'Duplicate a node',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Node UUID to duplicate',
            },
            includeChildren: {
              type: 'boolean',
              description: 'Include children nodes',
              default: true,
            },
          },
          required: ['uuid'],
        },
      },
      {
        name: 'detect_node_type',
        description: 'Detect if a node is 2D or 3D based on its components and properties',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Node UUID to analyze',
            },
          },
          required: ['uuid'],
        },
      },
    ]
  }

  async execute(toolName: string, args: unknown): Promise<ToolResponse> {
    if (!isToolArguments(args)) {
      return toolFailure('Tool arguments must be a JSON object')
    }

    switch (toolName) {
      case 'create_node':
        return typeof args.name === 'string' ? this.createNode(args as CreateNodeInput) : toolFailure('create_node requires a name string')
      case 'get_node_info':
        return typeof args.uuid === 'string' ? this.getNodeInfo(args.uuid) : toolFailure('get_node_info requires uuid')
      case 'find_nodes':
        return typeof args.pattern === 'string' && (args.exactMatch === undefined || typeof args.exactMatch === 'boolean')
          ? this.findNodes(args.pattern, args.exactMatch)
          : toolFailure('find_nodes requires pattern and optional exactMatch')
      case 'find_node_by_name':
        return typeof args.name === 'string' ? this.findNodeByName(args.name) : toolFailure('find_node_by_name requires name')
      case 'get_all_nodes':
        return this.getAllNodes()
      case 'set_node_property':
        return typeof args.uuid === 'string' && typeof args.property === 'string' && Object.hasOwn(args, 'value')
          ? this.setNodeProperty(args.uuid, args.property, args.value)
          : toolFailure('set_node_property requires uuid, property, and value')
      case 'set_node_transform':
        return typeof args.uuid === 'string' ? this.setNodeTransform(args as NodeTransformInput) : toolFailure('set_node_transform requires uuid')
      case 'delete_node':
        return typeof args.uuid === 'string' ? this.deleteNode(args.uuid) : toolFailure('delete_node requires uuid')
      case 'move_node':
        return typeof args.nodeUuid === 'string' && typeof args.newParentUuid === 'string' && (args.siblingIndex === undefined || typeof args.siblingIndex === 'number')
          ? this.moveNode(args.nodeUuid, args.newParentUuid, args.siblingIndex)
          : toolFailure('move_node requires nodeUuid, newParentUuid, and optional siblingIndex')
      case 'duplicate_node':
        return typeof args.uuid === 'string' && (args.includeChildren === undefined || typeof args.includeChildren === 'boolean')
          ? this.duplicateNode(args.uuid, args.includeChildren)
          : toolFailure('duplicate_node requires uuid and optional includeChildren')
      case 'detect_node_type':
        return typeof args.uuid === 'string' ? this.detectNodeType(args.uuid) : toolFailure('detect_node_type requires uuid')
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async createNode(args: CreateNodeInput): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        let targetParentUuid = args.parentUuid

        // 如果没有提供父节点UUID，获取场景根节点
        if (!targetParentUuid) {
          try {
            const sceneInfo = await requestScene('query-node-tree')
            if (typeof sceneInfo.uuid === 'string') {
              targetParentUuid = sceneInfo.uuid
              console.log(`No parent specified, using scene root: ${targetParentUuid}`)
            }
            else {
              const currentScene = await requestScene('query-current-scene')
              if (currentScene && currentScene.uuid) {
                targetParentUuid = currentScene.uuid
              }
            }
          }
          catch (err) {
            console.warn('Failed to get scene root, will use default behavior')
          }
        }

        // 如果提供了assetPath，先解析为assetUuid
        let finalAssetUuid = args.assetUuid
        if (args.assetPath && !finalAssetUuid) {
          try {
            const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', args.assetPath)
            if (assetInfo && assetInfo.uuid) {
              finalAssetUuid = assetInfo.uuid
              console.log(`Asset path '${args.assetPath}' resolved to UUID: ${finalAssetUuid}`)
            }
            else {
              resolve({
                success: false,
                error: `Asset not found at path: ${args.assetPath}`,
              })
              return
            }
          }
          catch (err) {
            resolve({
              success: false,
              error: `Failed to resolve asset path '${args.assetPath}': ${err}`,
            })
            return
          }
        }

        // 构建create-node选项
        const createNodeOptions: Record<string, unknown> = {
          name: args.name,
        }

        // 设置父节点
        if (targetParentUuid) {
          createNodeOptions.parent = targetParentUuid
        }

        // 从资源实例化
        if (finalAssetUuid) {
          createNodeOptions.assetUuid = finalAssetUuid
          if (args.unlinkPrefab) {
            createNodeOptions.unlinkPrefab = true
          }
        }

        if (args.nodeType && args.nodeType !== 'Node' && !finalAssetUuid)
          createNodeOptions.type = args.nodeType

        // 保持世界变换
        if (args.keepWorldTransform) {
          createNodeOptions.keepWorldTransform = true
        }

        // 不使用dump参数处理初始变换，创建后使用set_node_transform设置

        console.log('Creating node with options:', createNodeOptions)

        // 创建节点
        const nodeUuid = await Editor.Message.request('scene', 'create-node', createNodeOptions)
        const uuid = Array.isArray(nodeUuid) ? nodeUuid[0] : nodeUuid

        // 处理兄弟索引
        if (args.siblingIndex !== undefined && args.siblingIndex >= 0 && uuid && targetParentUuid) {
          try {
            await new Promise(resolve => setTimeout(resolve, 100)) // 等待内部状态更新
            await Editor.Message.request('scene', 'set-parent', {
              parent: targetParentUuid,
              uuids: [uuid],
              keepWorldTransform: args.keepWorldTransform || false,
            })
          }
          catch (err) {
            console.warn('Failed to set sibling index:', err)
          }
        }

        // 添加组件（如果提供的话）
        if (args.components && args.components.length > 0 && uuid) {
          try {
            await new Promise(resolve => setTimeout(resolve, 100)) // 等待节点创建完成
            for (const componentType of args.components) {
              try {
                const result = await this.componentTools.execute('add_component', {
                  nodeUuid: uuid,
                  componentType,
                })
                if (result.success) {
                  console.log(`Component ${componentType} added successfully`)
                }
                else {
                  console.warn(`Failed to add component ${componentType}:`, result.error)
                }
              }
              catch (err) {
                console.warn(`Failed to add component ${componentType}:`, err)
              }
            }
          }
          catch (err) {
            console.warn('Failed to add components:', err)
          }
        }

        // 设置初始变换（如果提供的话）
        if (args.initialTransform && uuid) {
          try {
            await new Promise(resolve => setTimeout(resolve, 150)) // 等待节点和组件创建完成
            await this.setNodeTransform({
              uuid,
              position: args.initialTransform.position,
              rotation: args.initialTransform.rotation,
              scale: args.initialTransform.scale,
            })
            console.log('Initial transform applied successfully')
          }
          catch (err) {
            console.warn('Failed to set initial transform:', err)
          }
        }

        // 获取创建后的节点信息进行验证
        let verificationData: Record<string, unknown> | null = null
        try {
          const nodeInfo = await this.getNodeInfo(uuid)
          if (nodeInfo.success) {
            verificationData = {
              nodeInfo: nodeInfo.data,
              creationDetails: {
                parentUuid: targetParentUuid,
                nodeType: args.nodeType || 'Node',
                fromAsset: !!finalAssetUuid,
                assetUuid: finalAssetUuid,
                assetPath: args.assetPath,
                timestamp: new Date().toISOString(),
              },
            }
          }
        }
        catch (err) {
          console.warn('Failed to get verification data:', err)
        }

        const successMessage = finalAssetUuid
          ? `Node '${args.name}' instantiated from asset successfully`
          : `Node '${args.name}' created successfully`

        resolve({
          success: true,
          data: {
            uuid,
            name: args.name,
            parentUuid: targetParentUuid,
            nodeType: args.nodeType || 'Node',
            fromAsset: !!finalAssetUuid,
            assetUuid: finalAssetUuid,
            message: successMessage,
          },
          verificationData,
        })
      }
      catch (err: unknown) {
        resolve({
          success: false,
          error: `Failed to create node: ${err instanceof Error ? err.message : String(err)}. Args: ${JSON.stringify(args)}`,
        })
      }
    })
  }

  private async getNodeInfo(uuid: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      requestScene('query-node', uuid).then((nodeData) => {
        if (!nodeData) {
          resolve({
            success: false,
            error: 'Node not found or invalid response',
          })
          return
        }

        // 根据实际返回的数据结构解析节点信息
        const info: NodeInfo = {
          uuid: nodeData.uuid?.value || uuid,
          name: nodeData.name?.value || 'Unknown',
          active: nodeData.active?.value !== undefined ? nodeData.active.value : true,
          position: nodeData.position?.value || { x: 0, y: 0, z: 0 },
          rotation: nodeData.rotation?.value || { x: 0, y: 0, z: 0 },
          scale: nodeData.scale?.value || { x: 1, y: 1, z: 1 },
          parent: nodeData.parent?.value?.uuid,
          children: nodeData.children || [],
          components: (nodeData.__comps__ || []).map(comp => this.parseComponentSummary(comp)),
          layer: nodeData.layer?.value || 1073741824,
          mobility: nodeData.mobility?.value || 0,
        }
        resolve({ success: true, data: info })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  /**
   * 把 query-node 返回的原始组件对象解析为统一的概要信息。
   * 兼容多种 type 字段命名（type / cid / __type__）以及嵌套在 value 中的结构。
   */
  private parseComponentSummary(comp: SceneComponentDump): { type: string, name: string, uuid: string | null, enabled: boolean } {
    const rawType = comp.type || comp.cid || comp.__type__ || ''
    const rawName = comp.value?.name || comp.name || ''
    // comp.uuid 可能是字符串，也可能是 { value: 'xxx' } 形式
    let compUuid: string | null = null
    if (typeof comp.uuid === 'string') {
      compUuid = comp.uuid
    }
    else if (comp.uuid && typeof comp.uuid === 'object') {
      compUuid = comp.uuid.value ?? null
    }
    else if (comp.value && comp.value.uuid) {
      if (typeof comp.value.uuid === 'string') {
        compUuid = comp.value.uuid
      }
      else if (typeof comp.value.uuid === 'object') {
        compUuid = comp.value.uuid.value ?? null
      }
    }

    // 一些内建组件（如 cc.UITransform）只有 cid 没有 type，需要补一个可读名
    const friendlyName = this.friendlyComponentName(rawName, rawType, comp)
    return {
      type: rawType || 'Unknown',
      name: friendlyName,
      uuid: compUuid,
      enabled: comp.enabled !== undefined ? comp.enabled : true,
    }
  }

  private friendlyComponentName(name: string, type: string, comp: SceneComponentDump): string {
    if (name && typeof name === 'string') {
      // 形如 "Emitter<UITransform>" 透传即可
      return name
    }
    if (type) {
      return type
    }
    if (comp && comp.__type__) {
      return comp.__type__
    }
    return 'Unknown'
  }

  private async findNodes(pattern: string, exactMatch: boolean = false): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // Note: 'query-nodes-by-name' API doesn't exist in official documentation
      // Using tree traversal as primary approach
      requestScene('query-node-tree').then((tree) => {
        const nodes: Array<{ uuid?: string, name: string, path: string }> = []

        const searchTree = (node: SceneNodeDump, currentPath: string = '') => {
          const nodeName = node.name || 'Unknown'
          const nodePath = currentPath ? `${currentPath}/${nodeName}` : nodeName

          const matches = exactMatch
            ? nodeName === pattern
            : nodeName.toLowerCase().includes(pattern.toLowerCase())

          if (matches) {
            nodes.push({
              uuid: node.uuid,
              name: nodeName,
              path: nodePath,
            })
          }

          if (node.children) {
            for (const child of node.children) {
              searchTree(child, nodePath)
            }
          }
        }

        if (tree) {
          searchTree(tree)
        }

        resolve({ success: true, data: nodes })
      }).catch((err: Error) => {
        // 备用方案：使用场景脚本
        const options = {
          name: 'cocos-mcp-server',
          method: 'findNodes',
          args: [pattern, exactMatch],
        }

        Editor.Message.request('scene', 'execute-scene-script', options).then((result) => {
          resolve(result)
        }).catch((err2: Error) => {
          resolve({ success: false, error: `Tree search failed: ${err.message}, Scene script failed: ${err2.message}` })
        })
      })
    })
  }

  private async findNodeByName(name: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 优先尝试使用 Editor API 查询节点树并搜索
      requestScene('query-node-tree').then((tree) => {
        const foundNode = this.searchNodeInTree(tree, name)
        if (foundNode) {
          resolve({
            success: true,
            data: {
              uuid: foundNode.uuid,
              name: foundNode.name,
              path: this.getNodePath(foundNode),
            },
          })
        }
        else {
          resolve({ success: false, error: `Node '${name}' not found` })
        }
      }).catch((err: Error) => {
        // 备用方案：使用场景脚本
        const options = {
          name: 'cocos-mcp-server',
          method: 'findNodeByName',
          args: [name],
        }

        Editor.Message.request('scene', 'execute-scene-script', options).then((result) => {
          resolve(result)
        }).catch((err2: Error) => {
          resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` })
        })
      })
    })
  }

  private searchNodeInTree(node: SceneNodeDump, targetName: string): SceneNodeDump | null {
    if (node.name === targetName) {
      return node
    }

    if (node.children) {
      for (const child of node.children) {
        const found = this.searchNodeInTree(child, targetName)
        if (found) {
          return found
        }
      }
    }

    return null
  }

  private async getAllNodes(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 尝试查询场景节点树
      requestScene('query-node-tree').then((tree) => {
        const nodes: Array<{ uuid?: string, name?: string, type?: string, active?: boolean, path: string }> = []

        const traverseTree = (node: SceneNodeDump) => {
          nodes.push({
            uuid: node.uuid,
            name: node.name,
            type: node.type,
            active: node.active,
            path: this.getNodePath(node),
          })

          if (node.children) {
            for (const child of node.children) {
              traverseTree(child)
            }
          }
        }

        if (tree && tree.children) {
          traverseTree(tree)
        }

        resolve({
          success: true,
          data: {
            totalNodes: nodes.length,
            nodes,
          },
        })
      }).catch((err: Error) => {
        // 备用方案：使用场景脚本
        const options = {
          name: 'cocos-mcp-server',
          method: 'getAllNodes',
          args: [],
        }

        Editor.Message.request('scene', 'execute-scene-script', options).then((result) => {
          resolve(result)
        }).catch((err2: Error) => {
          resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` })
        })
      })
    })
  }

  private getNodePath(node: SceneNodeDump): string {
    const path = [node.name || 'Unknown']
    let current = node.parent
    while (current && current.name !== 'Canvas') {
      path.unshift(current.name || 'Unknown')
      current = current.parent
    }
    return path.join('/')
  }

  /**
   * 把 value 规范化为 set-property API 期望的 dump 形态：
   *   - 引用类型：{ __type__, __id__ } / { __type__, __uuid__ } / { uuid } → dump.value = { uuid }, dump.type = cc.Node|cc.Component|...
   *   - ValueType (Color/Size/Vec2/Vec3)：原样 + dump.type 推导
   *   - 其他：原样
   */
  private async setNodeProperty(uuid: string, property: string, value: unknown): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const { dumpValue, dumpType } = normalizeNodeDumpValue(value, property)
      const dump: { value: unknown, type?: string } = { value: dumpValue }
      if (dumpType) {
        dump.type = dumpType
      }

      // 尝试直接使用 Editor API 设置节点属性
      requestScene('set-property', {
        uuid,
        path: property,
        dump,
      }).then(async () => {
        // 验证：重新 query 节点确认值是否真的写入
        let verified = false
        let actualStoredValue: unknown
        try {
          const nodeData = await requestScene('query-node', uuid)
          if (nodeData && Array.isArray(nodeData.__comps__)) {
            // 寻找挂在该节点上的某个组件（任意一个），从中读出该 property
            for (const c of nodeData.__comps__) {
              if (c && c.value && Object.prototype.hasOwnProperty.call(c.value, property)) {
                actualStoredValue = c.value[property]
                verified = JSON.stringify(actualStoredValue) === JSON.stringify(value)
                if (verified)
                  break
              }
            }
          }
        }
        catch {
          // ignore verify failure
        }

        // 验证不通过时再次尝试通过 set-property 走场景脚本，强制刷新
        if (!verified) {
          try {
            await Editor.Message.request('scene', 'execute-scene-script', {
              name: 'cocos-mcp-server',
              method: 'setPropertyForce',
              args: [uuid, property, value, dumpType],
            })
          }
          catch {
            // 忽略场景脚本失败
          }
        }

        resolve({
          success: true,
          message: verified
            ? `Property '${property}' updated successfully`
            : `Property '${property}' write reported, but verification failed. Please re-open the scene.`,
          data: {
            nodeUuid: uuid,
            property,
            newValue: value,
            dumpType,
            verified,
            actualStoredValue,
          },
        })
      }).catch((err: Error) => {
        // 如果直接设置失败，尝试使用场景脚本
        const options = {
          name: 'cocos-mcp-server',
          method: 'setNodeProperty',
          args: [uuid, property, value, dumpType],
        }

        Editor.Message.request('scene', 'execute-scene-script', options).then((result) => {
          resolve(result)
        }).catch((err2: Error) => {
          resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` })
        })
      })
    })
  }

  private async setNodeTransform(args: NodeTransformInput): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      const { uuid, position, rotation, scale } = args
      const updatePromises: Promise<unknown>[] = []
      const updates: string[] = []
      const warnings: string[] = []

      try {
        // First get node info to determine if it's 2D or 3D
        const nodeInfoResponse = await this.getNodeInfo(uuid)
        if (!nodeInfoResponse.success || !nodeInfoResponse.data) {
          resolve({ success: false, error: 'Failed to get node information' })
          return
        }

        const nodeInfo = nodeInfoResponse.data
        const is2DNode = is2DNodeInfo(nodeInfo)

        if (position) {
          const normalizedPosition = normalizeNodeTransformValue(position, 'position', is2DNode)
          if (normalizedPosition.warning) {
            warnings.push(normalizedPosition.warning)
          }

          updatePromises.push(
            requestScene('set-property', {
              uuid,
              path: 'position',
              dump: { value: normalizedPosition.value },
            }),
          )
          updates.push('position')
        }

        if (rotation) {
          const normalizedRotation = normalizeNodeTransformValue(rotation, 'rotation', is2DNode)
          if (normalizedRotation.warning) {
            warnings.push(normalizedRotation.warning)
          }

          updatePromises.push(
            requestScene('set-property', {
              uuid,
              path: 'rotation',
              dump: { value: normalizedRotation.value },
            }),
          )
          updates.push('rotation')
        }

        if (scale) {
          const normalizedScale = normalizeNodeTransformValue(scale, 'scale', is2DNode)
          if (normalizedScale.warning) {
            warnings.push(normalizedScale.warning)
          }

          updatePromises.push(
            requestScene('set-property', {
              uuid,
              path: 'scale',
              dump: { value: normalizedScale.value },
            }),
          )
          updates.push('scale')
        }

        if (updatePromises.length === 0) {
          resolve({ success: false, error: 'No transform properties specified' })
          return
        }

        await Promise.all(updatePromises)

        // Verify the changes by getting updated node info
        const updatedNodeInfo = await this.getNodeInfo(uuid)
        const response: ToolResponse = {
          success: true,
          message: `Transform properties updated: ${updates.join(', ')} ${is2DNode ? '(2D node)' : '(3D node)'}`,
          updatedProperties: updates,
          data: {
            nodeUuid: uuid,
            nodeType: is2DNode ? '2D' : '3D',
            appliedChanges: updates,
            transformConstraints: {
              position: is2DNode ? 'x, y only (z ignored)' : 'x, y, z all used',
              rotation: is2DNode ? 'z only (x, y ignored)' : 'x, y, z all used',
              scale: is2DNode ? 'x, y main, z typically 1' : 'x, y, z all used',
            },
          },
          verificationData: {
            nodeInfo: updatedNodeInfo.data,
            transformDetails: {
              originalNodeType: is2DNode ? '2D' : '3D',
              appliedTransforms: updates,
              timestamp: new Date().toISOString(),
            },
            beforeAfterComparison: {
              before: nodeInfo,
              after: updatedNodeInfo.data,
            },
          },
        }

        if (warnings.length > 0) {
          response.warning = warnings.join('; ')
        }

        resolve(response)
      }
      catch (err: unknown) {
        resolve({
          success: false,
          error: `Failed to update transform: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    })
  }

  private async deleteNode(uuid: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'remove-node', { uuid }).then(() => {
        resolve({
          success: true,
          message: 'Node deleted successfully',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async moveNode(nodeUuid: string, newParentUuid: string, siblingIndex: number = -1): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // Use correct set-parent API instead of move-node
      Editor.Message.request('scene', 'set-parent', {
        parent: newParentUuid,
        uuids: [nodeUuid],
        keepWorldTransform: false,
      }).then(() => {
        resolve({
          success: true,
          message: 'Node moved successfully',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async duplicateNode(uuid: string, includeChildren: boolean = true): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // Note: includeChildren parameter is accepted for future use but not currently implemented
      Editor.Message.request('scene', 'duplicate-node', uuid).then((result) => {
        resolve({
          success: true,
          data: {
            newUuid: result[0] ?? null,
            message: 'Node duplicated successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async detectNodeType(uuid: string): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        const nodeInfoResponse = await this.getNodeInfo(uuid)
        if (!nodeInfoResponse.success || !nodeInfoResponse.data) {
          resolve({ success: false, error: 'Failed to get node information' })
          return
        }

        const nodeInfo = nodeInfoResponse.data
        const is2D = is2DNodeInfo(nodeInfo)
        const components: unknown[] = Array.isArray(nodeInfo.components) ? nodeInfo.components : []

        // Collect detection reasons
        const detectionReasons: string[] = []

        // Check for 2D components
        const twoDComponents = components.filter(component => ['cc.Sprite', 'cc.Label', 'cc.Button', 'cc.Layout', 'cc.Widget', 'cc.Mask', 'cc.Graphics']
          .some(type => getComponentType(component)?.includes(type)))

        // Check for 3D components
        const threeDComponents = components.filter(component => ['cc.MeshRenderer', 'cc.Camera', 'cc.Light', 'cc.DirectionalLight', 'cc.PointLight', 'cc.SpotLight']
          .some(type => getComponentType(component)?.includes(type)))

        if (twoDComponents.length > 0) {
          detectionReasons.push(`Has 2D components: ${twoDComponents.map(component => getComponentType(component) ?? 'Unknown').join(', ')}`)
        }

        if (threeDComponents.length > 0) {
          detectionReasons.push(`Has 3D components: ${threeDComponents.map(component => getComponentType(component) ?? 'Unknown').join(', ')}`)
        }

        // Check position for heuristic
        const position = nodeInfo.position
        if (position && Math.abs(position.z) < 0.001) {
          detectionReasons.push('Z position is ~0 (likely 2D)')
        }
        else if (position && Math.abs(position.z) > 0.001) {
          detectionReasons.push(`Z position is ${position.z} (likely 3D)`)
        }

        if (detectionReasons.length === 0) {
          detectionReasons.push('No specific indicators found, defaulting based on heuristics')
        }

        resolve({
          success: true,
          data: {
            nodeUuid: uuid,
            nodeName: nodeInfo.name,
            nodeType: is2D ? '2D' : '3D',
            detectionReasons,
            components: components.map(component => ({
              type: getComponentType(component) ?? 'Unknown',
              category: this.getComponentCategory(getComponentType(component) ?? ''),
            })),
            position: nodeInfo.position,
            transformConstraints: {
              position: is2D ? 'x, y only (z ignored)' : 'x, y, z all used',
              rotation: is2D ? 'z only (x, y ignored)' : 'x, y, z all used',
              scale: is2D ? 'x, y main, z typically 1' : 'x, y, z all used',
            },
          },
        })
      }
      catch (err: unknown) {
        resolve({
          success: false,
          error: `Failed to detect node type: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    })
  }

  private getComponentCategory(componentType: string): string {
    if (!componentType)
      return 'unknown'

    if (componentType.includes('cc.Sprite') || componentType.includes('cc.Label')
      || componentType.includes('cc.Button') || componentType.includes('cc.Layout')
      || componentType.includes('cc.Widget') || componentType.includes('cc.Mask')
      || componentType.includes('cc.Graphics')) {
      return '2D'
    }

    if (componentType.includes('cc.MeshRenderer') || componentType.includes('cc.Camera')
      || componentType.includes('cc.Light') || componentType.includes('cc.DirectionalLight')
      || componentType.includes('cc.PointLight') || componentType.includes('cc.SpotLight')) {
      return '3D'
    }

    return 'generic'
  }
}
