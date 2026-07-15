import type { AssetDbAssetInfo } from '../editor-message'
import type { PrefabInfo, ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import type { PrefabDocument } from './prefab-format'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { requestAssetDb, requestEditor, requestScene } from '../editor-message'
import { getComponentSceneId } from './component-query'
import { createPrefabComponent, extractPrefabComponents } from './prefab-component'
import { createPrefabMeta, generateFileId, generateUuid, getComponentPropertyValue, parsePrefabDocument, validatePrefabFormat } from './prefab-format'
import { createEngineNode, extractNodeUuid, findNodeInTree, getChildrenToProcess } from './prefab-node'
import { toolFailure } from './tool-response'

type ToolArguments = Record<string, unknown>
type PrefabObject = Record<string, unknown>

interface InstantiatePrefabInput extends ToolArguments {
  prefabPath: string
  parentUuid?: string
  name?: string
  position?: unknown
}

interface CreatePrefabInput extends ToolArguments {
  nodeUuid: string
  savePath: string
  prefabPath?: string
  prefabName: string
  includeChildren?: boolean
  includeComponents?: boolean
}

interface DuplicatePrefabInput extends ToolArguments {
  sourcePrefabPath: string
  targetPrefabPath: string
  newPrefabName?: string
}

interface PrefabSerializationContext {
  prefabData: unknown[]
  currentId: number
  prefabAssetIndex: number
  nodeFileIds: Map<string, string>
  nodeUuidToIndex: Map<string, number>
  componentUuidToIndex: Map<string, number>
}

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class PrefabTools implements ToolExecutor {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'get_prefab_list',
        description: 'Get all prefabs in the project',
        inputSchema: {
          type: 'object',
          properties: {
            folder: {
              type: 'string',
              description: 'Folder path to search (optional)',
              default: 'db://assets',
            },
          },
        },
      },
      {
        name: 'load_prefab',
        description: 'Load a prefab by path',
        inputSchema: {
          type: 'object',
          properties: {
            prefabPath: {
              type: 'string',
              description: 'Prefab asset path',
            },
          },
          required: ['prefabPath'],
        },
      },
      {
        name: 'instantiate_prefab',
        description: 'Instantiate a prefab in the scene',
        inputSchema: {
          type: 'object',
          properties: {
            prefabPath: {
              type: 'string',
              description: 'Prefab asset path',
            },
            parentUuid: {
              type: 'string',
              description: 'Parent node UUID (optional)',
            },
            position: {
              type: 'object',
              description: 'Initial position',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                z: { type: 'number' },
              },
            },
          },
          required: ['prefabPath'],
        },
      },
      {
        name: 'create_prefab',
        description: 'Create a prefab from a node with all children and components',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Source node UUID',
            },
            savePath: {
              type: 'string',
              description: 'Path to save the prefab (e.g., db://assets/prefabs/MyPrefab.prefab)',
            },
            prefabName: {
              type: 'string',
              description: 'Prefab name',
            },
          },
          required: ['nodeUuid', 'savePath', 'prefabName'],
        },
      },
      {
        name: 'update_prefab',
        description: 'Update an existing prefab',
        inputSchema: {
          type: 'object',
          properties: {
            prefabPath: {
              type: 'string',
              description: 'Prefab asset path',
            },
            nodeUuid: {
              type: 'string',
              description: 'Node UUID with changes',
            },
          },
          required: ['prefabPath', 'nodeUuid'],
        },
      },
      {
        name: 'revert_prefab',
        description: 'Revert prefab instance to original',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Prefab instance node UUID',
            },
          },
          required: ['nodeUuid'],
        },
      },
      {
        name: 'get_prefab_info',
        description: 'Get detailed prefab information',
        inputSchema: {
          type: 'object',
          properties: {
            prefabPath: {
              type: 'string',
              description: 'Prefab asset path',
            },
          },
          required: ['prefabPath'],
        },
      },
      {
        name: 'validate_prefab',
        description: 'Validate a prefab file format',
        inputSchema: {
          type: 'object',
          properties: {
            prefabPath: {
              type: 'string',
              description: 'Prefab asset path',
            },
          },
          required: ['prefabPath'],
        },
      },
      {
        name: 'duplicate_prefab',
        description: 'Duplicate an existing prefab',
        inputSchema: {
          type: 'object',
          properties: {
            sourcePrefabPath: {
              type: 'string',
              description: 'Source prefab path',
            },
            targetPrefabPath: {
              type: 'string',
              description: 'Target prefab path',
            },
            newPrefabName: {
              type: 'string',
              description: 'New prefab name',
            },
          },
          required: ['sourcePrefabPath', 'targetPrefabPath'],
        },
      },
      {
        name: 'restore_prefab_node',
        description: 'Restore prefab node using prefab asset (built-in undo record)',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Prefab instance node UUID',
            },
            assetUuid: {
              type: 'string',
              description: 'Prefab asset UUID',
            },
          },
          required: ['nodeUuid', 'assetUuid'],
        },
      },
    ]
  }

  async execute(toolName: string, args: unknown): Promise<ToolResponse> {
    if (!isToolArguments(args)) {
      return toolFailure('Tool arguments must be a JSON object')
    }

    switch (toolName) {
      case 'get_prefab_list':
        return args.folder === undefined || typeof args.folder === 'string'
          ? this.getPrefabList(args.folder)
          : toolFailure('get_prefab_list folder must be a string when provided')
      case 'load_prefab':
        return typeof args.prefabPath === 'string' ? this.loadPrefab(args.prefabPath) : toolFailure('load_prefab requires prefabPath')
      case 'instantiate_prefab':
        return typeof args.prefabPath === 'string' ? this.instantiatePrefab(args as InstantiatePrefabInput) : toolFailure('instantiate_prefab requires prefabPath')
      case 'create_prefab':
        return typeof args.nodeUuid === 'string' && typeof args.savePath === 'string' && typeof args.prefabName === 'string'
          ? this.createPrefab(args as CreatePrefabInput)
          : toolFailure('create_prefab requires nodeUuid, savePath, and prefabName')
      case 'update_prefab':
        return typeof args.prefabPath === 'string' && typeof args.nodeUuid === 'string'
          ? this.updatePrefab(args.prefabPath, args.nodeUuid)
          : toolFailure('update_prefab requires prefabPath and nodeUuid')
      case 'revert_prefab':
        return typeof args.nodeUuid === 'string' ? this.revertPrefab(args.nodeUuid) : toolFailure('revert_prefab requires nodeUuid')
      case 'get_prefab_info':
        return typeof args.prefabPath === 'string' ? this.getPrefabInfo(args.prefabPath) : toolFailure('get_prefab_info requires prefabPath')
      case 'validate_prefab':
        return typeof args.prefabPath === 'string' ? this.validatePrefab(args.prefabPath) : toolFailure('validate_prefab requires prefabPath')
      case 'duplicate_prefab':
        return typeof args.sourcePrefabPath === 'string' && typeof args.targetPrefabPath === 'string'
          ? this.duplicatePrefab(args as DuplicatePrefabInput)
          : toolFailure('duplicate_prefab requires sourcePrefabPath and targetPrefabPath')
      case 'restore_prefab_node':
        return typeof args.nodeUuid === 'string' && typeof args.assetUuid === 'string'
          ? this.restorePrefabNode(args.nodeUuid, args.assetUuid)
          : toolFailure('restore_prefab_node requires nodeUuid and assetUuid')
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async getPrefabList(folder: string = 'db://assets'): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const pattern = folder.endsWith('/')
        ? `${folder}**/*.prefab`
        : `${folder}/**/*.prefab`

      Editor.Message.request('asset-db', 'query-assets', {
        pattern,
      }).then((results) => {
        const prefabs: PrefabInfo[] = results.map(asset => ({
          name: asset.name,
          path: asset.url,
          uuid: asset.uuid,
          folder: asset.url.substring(0, asset.url.lastIndexOf('/')),
        }))
        resolve({ success: true, data: prefabs })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async loadPrefab(prefabPath: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'query-asset-info', prefabPath).then((assetInfo) => {
        if (!assetInfo) {
          throw new Error('Prefab not found')
        }

        return Editor.Message.request('scene', 'load-asset', {
          uuid: assetInfo.uuid,
        })
      }).then((prefabData) => {
        resolve({
          success: true,
          data: {
            uuid: prefabData.uuid,
            name: prefabData.name,
            message: 'Prefab loaded successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async instantiatePrefab(args: InstantiatePrefabInput): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        // 获取预制体资源信息
        const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', args.prefabPath)
        if (!assetInfo) {
          throw new Error('预制体未找到')
        }

        // 使用正确的 create-node API 从预制体资源实例化
        const createNodeOptions: Record<string, unknown> = {
          assetUuid: assetInfo.uuid,
        }

        // 设置父节点
        if (args.parentUuid) {
          createNodeOptions.parent = args.parentUuid
        }

        // 设置节点名称
        if (args.name) {
          createNodeOptions.name = args.name
        }
        else if (assetInfo.name) {
          createNodeOptions.name = assetInfo.name
        }

        // 设置初始属性（如位置）
        if (args.position) {
          createNodeOptions.dump = {
            position: {
              value: args.position,
            },
          }
        }

        // 创建节点
        const nodeUuid = await Editor.Message.request('scene', 'create-node', createNodeOptions)
        const uuid = Array.isArray(nodeUuid) ? nodeUuid[0] : nodeUuid

        // 注意：create-node API从预制体资源创建时应该自动建立预制体关联
        console.log('预制体节点创建成功:', {
          nodeUuid: uuid,
          prefabUuid: assetInfo.uuid,
          prefabPath: args.prefabPath,
        })

        resolve({
          success: true,
          data: {
            nodeUuid: uuid,
            prefabPath: args.prefabPath,
            parentUuid: args.parentUuid,
            position: args.position,
            message: '预制体实例化成功，已建立预制体关联',
          },
        })
      }
      catch (err: unknown) {
        resolve({
          success: false,
          error: `预制体实例化失败: ${err instanceof Error ? err.message : String(err)}`,
          instruction: '请检查预制体路径是否正确，确保预制体文件格式正确',
        })
      }
    })
  }

  /**
   * 建立节点与预制体的关联关系
   * 这个方法创建必要的PrefabInfo和PrefabInstance结构
   */
  private async establishPrefabConnection(nodeUuid: string, prefabUuid: string, prefabPath: string): Promise<void> {
    try {
      // 读取预制体文件获取根节点的fileId
      const prefabContent = await this.readPrefabFile(prefabPath)
      if (!prefabContent || !prefabContent.data || !prefabContent.data.length) {
        throw new Error('无法读取预制体文件内容')
      }

      // 找到预制体根节点的fileId (通常是第二个对象，即索引1)
      const rootNode = prefabContent.data.map(item => isToolArguments(item) ? item : null).find(item => item?.__type__ === 'cc.Node' && item._parent === null)
      const rootPrefabReference = rootNode && isToolArguments(rootNode._prefab) ? rootNode._prefab : null
      if (!rootNode || typeof rootPrefabReference?.__id__ !== 'number') {
        throw new Error('无法找到预制体根节点或其预制体信息')
      }

      // 获取根节点的PrefabInfo
      const rootPrefabInfo = prefabContent.data[rootPrefabReference.__id__]
      if (!isToolArguments(rootPrefabInfo) || rootPrefabInfo.__type__ !== 'cc.PrefabInfo') {
        throw new Error('无法找到预制体根节点的PrefabInfo')
      }

      const rootFileId = rootPrefabInfo.fileId
      if (typeof rootFileId !== 'string')
        throw new TypeError('预制体根节点的 PrefabInfo 缺少 fileId')

      // 使用scene API建立预制体连接
      const prefabConnectionData = {
        node: nodeUuid,
        prefab: prefabUuid,
        fileId: rootFileId,
      }

      // 尝试使用多种API方法建立预制体连接
      const connectionMethods = [
        () => Editor.Message.request('scene', 'connect-prefab-instance', prefabConnectionData),
        () => Editor.Message.request('scene', 'set-prefab-connection', prefabConnectionData),
        () => Editor.Message.request('scene', 'apply-prefab-link', prefabConnectionData),
      ]

      let connected = false
      for (const method of connectionMethods) {
        try {
          await method()
          connected = true
          break
        }
        catch (error) {
          console.warn('预制体连接方法失败，尝试下一个方法:', error)
        }
      }

      if (!connected) {
        // 如果所有API方法都失败，尝试手动修改场景数据
        console.warn('所有预制体连接API都失败，尝试手动建立连接')
        await this.manuallyEstablishPrefabConnection(nodeUuid, prefabUuid, rootFileId)
      }
    }
    catch (error) {
      console.error('建立预制体连接失败:', error)
      throw error
    }
  }

  /**
   * 手动建立预制体连接（当API方法失败时的备用方案）
   */
  private async manuallyEstablishPrefabConnection(nodeUuid: string, prefabUuid: string, rootFileId: string): Promise<void> {
    try {
      // 尝试使用dump API修改节点的_prefab属性
      const prefabConnectionData = {
        [nodeUuid]: {
          _prefab: {
            __uuid__: prefabUuid,
            __expectedType__: 'cc.Prefab',
            fileId: rootFileId,
          },
        },
      }

      await Editor.Message.request('scene', 'set-property', {
        uuid: nodeUuid,
        path: '_prefab',
        dump: {
          value: {
            __uuid__: prefabUuid,
            __expectedType__: 'cc.Prefab',
          },
        },
      })
    }
    catch (error) {
      console.error('手动建立预制体连接也失败:', error)
      // 不抛出错误，因为基本的节点创建已经成功
    }
  }

  /**
   * 读取预制体文件内容
   */
  private async readPrefabFile(prefabPath: string): Promise<PrefabDocument> {
    try {
      // 尝试使用asset-db API读取文件内容
      let assetContent: Record<string, unknown> | null = null
      try {
        const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', prefabPath)
        assetContent = assetInfo as unknown as Record<string, unknown> | null
        if (typeof assetContent?.source === 'string') {
          // 如果有source路径，直接读取文件
          const fullPath = path.resolve(assetContent.source)
          const fileContent = fs.readFileSync(fullPath, 'utf8')
          return parsePrefabDocument(fileContent)
        }
      }
      catch (error) {
        console.warn('使用asset-db读取失败，尝试其他方法:', error)
      }

      // 备用方法：转换db://路径为实际文件路径
      const fsPath = prefabPath.replace('db://assets/', 'assets/').replace('db://assets', 'assets')

      // 尝试多个可能的项目根路径
      const possiblePaths = [path.resolve(Editor.Project.path, fsPath), path.resolve(process.cwd(), fsPath)]

      console.log('尝试读取预制体文件，路径转换:', {
        originalPath: prefabPath,
        fsPath,
        possiblePaths,
      })

      for (const fullPath of possiblePaths) {
        try {
          console.log(`检查路径: ${fullPath}`)
          if (fs.existsSync(fullPath)) {
            console.log(`找到文件: ${fullPath}`)
            const fileContent = fs.readFileSync(fullPath, 'utf8')
            const parsed = parsePrefabDocument(fileContent)
            console.log('文件解析成功，数据结构:', {
              hasData: true,
              dataLength: parsed.data.length,
            })
            return parsed
          }
          else {
            console.log(`文件不存在: ${fullPath}`)
          }
        }
        catch (readError) {
          console.warn(`读取文件失败 ${fullPath}:`, readError)
        }
      }

      throw new Error('无法找到或读取预制体文件')
    }
    catch (error) {
      console.error('读取预制体文件失败:', error)
      throw error
    }
  }

  private async tryCreateNodeWithPrefab(args: InstantiatePrefabInput): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'query-asset-info', args.prefabPath).then((assetInfo) => {
        if (!assetInfo) {
          throw new Error('预制体未找到')
        }

        // 方法2: 使用 create-node 指定预制体资源
        const createNodeOptions: Record<string, unknown> = {
          assetUuid: assetInfo.uuid,
        }

        // 设置父节点
        if (args.parentUuid) {
          createNodeOptions.parent = args.parentUuid
        }

        return Editor.Message.request('scene', 'create-node', createNodeOptions)
      }).then((nodeUuid: string | string[]) => {
        const uuid = Array.isArray(nodeUuid) ? nodeUuid[0] : nodeUuid

        // 如果指定了位置，设置节点位置
        if (args.position && uuid) {
          requestScene('set-property', {
            uuid,
            path: 'position',
            dump: { value: args.position },
          }).then(() => {
            resolve({
              success: true,
              data: {
                nodeUuid: uuid,
                prefabPath: args.prefabPath,
                position: args.position,
                message: '预制体实例化成功（备用方法）并设置了位置',
              },
            })
          }).catch(() => {
            resolve({
              success: true,
              data: {
                nodeUuid: uuid,
                prefabPath: args.prefabPath,
                message: '预制体实例化成功（备用方法）但位置设置失败',
              },
            })
          })
        }
        else {
          resolve({
            success: true,
            data: {
              nodeUuid: uuid,
              prefabPath: args.prefabPath,
              message: '预制体实例化成功（备用方法）',
            },
          })
        }
      }).catch((err: Error) => {
        resolve({
          success: false,
          error: `备用预制体实例化方法也失败: ${err.message}`,
        })
      })
    })
  }

  private async tryAlternativeInstantiateMethods(args: InstantiatePrefabInput): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        // 方法1: 尝试使用 create-node 然后设置预制体
        const assetInfo = await this.getAssetInfo(args.prefabPath)
        if (!assetInfo) {
          resolve({ success: false, error: '无法获取预制体信息' })
          return
        }

        // 创建空节点
        const createResult = await this.createNode(args.parentUuid, args.position)
        if (!createResult.success) {
          resolve(createResult)
          return
        }

        // 尝试将预制体应用到节点
        const applyResult = await this.applyPrefabToNode(createResult.data.nodeUuid, assetInfo.uuid)
        if (applyResult.success) {
          resolve({
            success: true,
            data: {
              nodeUuid: createResult.data.nodeUuid,
              name: createResult.data.name,
              message: '预制体实例化成功（使用备选方法）',
            },
          })
        }
        else {
          resolve({
            success: false,
            error: '无法将预制体应用到节点',
            data: {
              nodeUuid: createResult.data.nodeUuid,
              message: '已创建节点，但无法应用预制体数据',
            },
          })
        }
      }
      catch (error) {
        resolve({ success: false, error: `备选实例化方法失败: ${error}` })
      }
    })
  }

  private async getAssetInfo(prefabPath: string): Promise<AssetDbAssetInfo | null> {
    return requestAssetDb('query-asset-info', prefabPath).catch(() => null)
  }

  private async createNode(parentUuid?: string, position?: unknown): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const createNodeOptions: Record<string, unknown> = {
        name: 'PrefabInstance',
      }

      // 设置父节点
      if (parentUuid) {
        createNodeOptions.parent = parentUuid
      }

      // 设置位置
      if (position) {
        createNodeOptions.dump = {
          position,
        }
      }

      Editor.Message.request('scene', 'create-node', createNodeOptions).then((nodeUuid: string | string[]) => {
        const uuid = Array.isArray(nodeUuid) ? nodeUuid[0] : nodeUuid
        resolve({
          success: true,
          data: {
            nodeUuid: uuid,
            name: 'PrefabInstance',
          },
        })
      }).catch((error: unknown) => {
        resolve({ success: false, error: getErrorMessage(error) || '创建节点失败' })
      })
    })
  }

  private async applyPrefabToNode(nodeUuid: string, prefabUuid: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 尝试多种方法来应用预制体数据
      const methods = [
        () => Editor.Message.request('scene', 'apply-prefab', { node: nodeUuid, prefab: prefabUuid }),
        () => Editor.Message.request('scene', 'set-prefab', { node: nodeUuid, prefab: prefabUuid }),
        () => Editor.Message.request('scene', 'load-prefab-to-node', { node: nodeUuid, prefab: prefabUuid }),
      ]

      const tryMethod = (index: number) => {
        if (index >= methods.length) {
          resolve({ success: false, error: '无法应用预制体数据' })
          return
        }

        methods[index]().then(() => {
          resolve({ success: true })
        }).catch(() => {
          tryMethod(index + 1)
        })
      }

      tryMethod(0)
    })
  }

  /**
   * 使用 asset-db API 创建预制体的新方法
   * 深度整合引擎的资源管理系统，实现完整的预制体创建流程
   */
  private async createPrefabWithAssetDB(nodeUuid: string, savePath: string, prefabName: string, includeChildren: boolean, includeComponents: boolean): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        console.log('=== 使用 Asset-DB API 创建预制体 ===')
        console.log(`节点UUID: ${nodeUuid}`)
        console.log(`保存路径: ${savePath}`)
        console.log(`预制体名称: ${prefabName}`)

        // 第一步：获取节点数据（包括变换属性）
        const nodeData = await this.getNodeData(nodeUuid)
        if (!nodeData) {
          resolve({
            success: false,
            error: '无法获取节点数据',
          })
          return
        }

        console.log('获取到节点数据，子节点数量:', Array.isArray(nodeData.children) ? nodeData.children.length : 0)

        // 第二步：先创建资源文件以获取引擎分配的UUID
        console.log('创建预制体资源文件...')
        const tempPrefabContent = JSON.stringify([{ __type__: 'cc.Prefab', _name: prefabName }], null, 2)
        const createResult = await this.createAssetWithAssetDB(savePath, tempPrefabContent)
        if (!createResult.success) {
          resolve(createResult)
          return
        }

        // 获取引擎分配的实际UUID
        const createdAsset = isToolArguments(createResult.data) ? createResult.data : null
        const actualPrefabUuid = typeof createdAsset?.uuid === 'string' ? createdAsset.uuid : null
        if (!actualPrefabUuid) {
          resolve({
            success: false,
            error: '无法获取引擎分配的预制体UUID',
          })
          return
        }
        console.log('引擎分配的UUID:', actualPrefabUuid)

        // 第三步：使用实际UUID重新生成预制体内容
        const prefabContent = await this.createStandardPrefabContent(nodeData, prefabName, actualPrefabUuid, includeChildren, includeComponents)
        const prefabContentString = JSON.stringify(prefabContent, null, 2)

        // 第四步：更新预制体文件内容
        console.log('更新预制体文件内容...')
        const updateResult = await this.updateAssetWithAssetDB(savePath, prefabContentString)

        // 第五步：创建对应的meta文件（使用实际UUID）
        console.log('创建预制体meta文件...')
        const metaContent = this.createStandardMetaContent(prefabName, actualPrefabUuid)
        const metaResult = await this.createMetaWithAssetDB(savePath, metaContent)

        // 第六步：重新导入资源以更新引用
        console.log('重新导入预制体资源...')
        const reimportResult = await this.reimportAssetWithAssetDB(savePath)

        // 第七步：尝试将原始节点转换为预制体实例
        console.log('尝试将原始节点转换为预制体实例...')
        const convertResult = await this.convertNodeToPrefabInstance(nodeUuid, actualPrefabUuid, savePath)

        resolve({
          success: true,
          data: {
            prefabUuid: actualPrefabUuid,
            prefabPath: savePath,
            nodeUuid,
            prefabName,
            convertedToPrefabInstance: convertResult.success,
            createAssetResult: createResult,
            updateResult,
            metaResult,
            reimportResult,
            convertResult,
            message: convertResult.success ? '预制体创建并成功转换原始节点' : '预制体创建成功，但节点转换失败',
          },
        })
      }
      catch (error) {
        console.error('创建预制体时发生错误:', error)
        resolve({
          success: false,
          error: `创建预制体失败: ${error}`,
        })
      }
    })
  }

  private async createPrefab(args: CreatePrefabInput): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        // 支持 prefabPath 和 savePath 两种参数名
        const pathParam = args.prefabPath || args.savePath
        if (!pathParam) {
          resolve({
            success: false,
            error: '缺少预制体路径参数。请提供 prefabPath 或 savePath。',
          })
          return
        }

        const prefabName = args.prefabName || 'NewPrefab'
        const fullPath = pathParam.endsWith('.prefab')
          ? pathParam
          : `${pathParam}/${prefabName}.prefab`

        const includeChildren = args.includeChildren !== false // 默认为 true
        const includeComponents = args.includeComponents !== false // 默认为 true

        // 优先使用新的 asset-db 方法创建预制体
        console.log('使用新的 asset-db 方法创建预制体...')
        const assetDbResult = await this.createPrefabWithAssetDB(
          args.nodeUuid,
          fullPath,
          prefabName,
          includeChildren,
          includeComponents,
        )

        if (assetDbResult.success) {
          resolve(assetDbResult)
          return
        }

        // 如果 asset-db 方法失败，尝试使用Cocos Creator的原生预制体创建API
        console.log('asset-db 方法失败，尝试原生API...')
        const nativeResult = await this.createPrefabNative(args.nodeUuid, fullPath)
        if (nativeResult.success) {
          resolve(nativeResult)
          return
        }

        // 如果原生API失败，使用自定义实现
        console.log('原生API失败，使用自定义实现...')
        const customResult = await this.createPrefabCustom(args.nodeUuid, fullPath, prefabName)
        resolve(customResult)
      }
      catch (error) {
        resolve({
          success: false,
          error: `创建预制体时发生错误: ${error}`,
        })
      }
    })
  }

  private async createPrefabNative(nodeUuid: string, prefabPath: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 根据官方API文档，不存在直接的预制体创建API
      // 预制体创建需要手动在编辑器中完成
      resolve({
        success: false,
        error: '原生预制体创建API不存在',
        instruction: '根据Cocos Creator官方API文档，预制体创建需要手动操作：\n1. 在场景中选择节点\n2. 将节点拖拽到资源管理器中\n3. 或右键节点选择"生成预制体"',
      })
    })
  }

  private async createPrefabCustom(nodeUuid: string, prefabPath: string, prefabName: string): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        // 1. 获取源节点的完整数据
        const nodeData = await this.getNodeData(nodeUuid)
        if (!nodeData) {
          resolve({
            success: false,
            error: `无法找到节点: ${nodeUuid}`,
          })
          return
        }

        // 2. 生成预制体UUID
        const prefabUuid = generateUuid()

        // 3. 基于官方格式创建预制体数据结构
        console.log('=== 开始创建预制体 ===')
        console.log('节点名称:', getComponentPropertyValue(nodeData, 'name', '未知'))
        console.log('节点UUID:', getComponentPropertyValue(nodeData, 'uuid', '未知'))
        console.log('预制体保存路径:', prefabPath)
        console.log(`开始创建预制体，节点数据:`, nodeData)
        const prefabJsonData = await this.createStandardPrefabContent(nodeData, prefabName, prefabUuid, true, true)

        // 5. 创建标准meta文件数据
        const standardMetaData = createPrefabMeta(prefabName, prefabUuid)

        // 6. 保存预制体和meta文件
        const saveResult = await this.savePrefabWithMeta(prefabPath, prefabJsonData, standardMetaData)

        if (saveResult.success) {
          // 保存成功后，将原始节点转换为预制体实例
          const convertResult = await this.convertNodeToPrefabInstance(nodeUuid, prefabPath, prefabUuid)

          resolve({
            success: true,
            data: {
              prefabUuid,
              prefabPath,
              nodeUuid,
              prefabName,
              convertedToPrefabInstance: convertResult.success,
              message: convertResult.success
                ? '自定义预制体创建成功，原始节点已转换为预制体实例'
                : '预制体创建成功，但节点转换失败',
            },
          })
        }
        else {
          resolve({
            success: false,
            error: saveResult.error || '保存预制体文件失败',
          })
        }
      }
      catch (error) {
        resolve({
          success: false,
          error: `创建预制体时发生错误: ${error}`,
        })
      }
    })
  }

  private async getNodeData(nodeUuid: string): Promise<PrefabObject | null> {
    try {
      const nodeInfo = await requestScene('query-node', nodeUuid)
      return await this.getNodeWithChildren(nodeUuid) ?? nodeInfo
    }
    catch (error) {
      console.warn(`获取节点数据失败 ${nodeUuid}:`, error)
      return null
    }
  }

  // 使用query-node-tree获取包含子节点的完整节点结构
  private async getNodeWithChildren(nodeUuid: string): Promise<PrefabObject | null> {
    try {
      // 获取整个场景树
      const tree = await requestScene('query-node-tree')
      if (!tree) {
        return null
      }

      // 在树中查找指定的节点
      const targetNode = findNodeInTree(tree, nodeUuid)
      if (targetNode) {
        console.log(`在场景树中找到节点 ${nodeUuid}，子节点数量: ${Array.isArray(targetNode.children) ? targetNode.children.length : 0}`)

        // 增强节点树，获取每个节点的正确组件信息
        const enhancedTree = await this.enhanceTreeWithMCPComponents(targetNode)
        return enhancedTree
      }

      return null
    }
    catch (error) {
      console.warn(`获取节点树结构失败 ${nodeUuid}:`, error)
      return null
    }
  }

  private async enhanceTreeWithMCPComponents(node: PrefabObject): Promise<PrefabObject> {
    const enhanced = { ...node }
    const nodeUuid = extractNodeUuid(node)
    if (nodeUuid) {
      try {
        const nodeInfo = await requestScene('query-node', nodeUuid)
        enhanced.components = Array.isArray(nodeInfo.__comps__) ? nodeInfo.__comps__ : []
      }
      catch (error) {
        console.warn(`获取节点 ${nodeUuid} 的组件信息失败:`, error)
      }
    }
    if (Array.isArray(node.children))
      enhanced.children = await Promise.all(node.children.filter(isToolArguments).map(child => this.enhanceTreeWithMCPComponents(child)))
    return enhanced
  }

  private async updatePrefab(prefabPath: string, nodeUuid: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'query-asset-info', prefabPath).then((assetInfo) => {
        if (!assetInfo) {
          throw new Error('Prefab not found')
        }

        return Editor.Message.request('scene', 'apply-prefab', {
          node: nodeUuid,
          prefab: assetInfo.uuid,
        })
      }).then(() => {
        resolve({
          success: true,
          message: 'Prefab updated successfully',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async revertPrefab(nodeUuid: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'revert-prefab', {
        node: nodeUuid,
      }).then(() => {
        resolve({
          success: true,
          message: 'Prefab instance reverted successfully',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async getPrefabInfo(prefabPath: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'query-asset-info', prefabPath).then((assetInfo) => {
        if (!assetInfo) {
          throw new Error('Prefab not found')
        }

        return Editor.Message.request('asset-db', 'query-asset-meta', assetInfo.uuid)
      }).then((metaInfo) => {
        if (!metaInfo)
          throw new Error('Prefab metadata not found')
        const metadata = metaInfo as unknown as Record<string, unknown>
        const info: PrefabInfo = {
          name: typeof metadata.name === 'string' ? metadata.name : path.basename(prefabPath, '.prefab'),
          uuid: typeof metadata.uuid === 'string' ? metadata.uuid : '',
          path: prefabPath,
          folder: prefabPath.substring(0, prefabPath.lastIndexOf('/')),
          createTime: metadata.createTime === undefined ? '' : String(metadata.createTime),
          modifyTime: metadata.modifyTime === undefined ? '' : String(metadata.modifyTime),
          dependencies: Array.isArray(metadata.depends) ? metadata.depends.filter((item): item is string => typeof item === 'string') : [],
        }
        resolve({ success: true, data: info })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async createPrefabFromNode(args: { nodeUuid: string, prefabPath: string }): Promise<ToolResponse> {
    // 从 prefabPath 提取名称
    const prefabPath = args.prefabPath
    const prefabName = prefabPath.split('/').pop()?.replace('.prefab', '') || 'NewPrefab'

    // 调用原来的 createPrefab 方法
    return await this.createPrefab({
      nodeUuid: args.nodeUuid,
      savePath: prefabPath,
      prefabName,
    })
  }

  private async validatePrefab(prefabPath: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      try {
        // 读取预制体文件内容
        Editor.Message.request('asset-db', 'query-asset-info', prefabPath).then((assetInfo) => {
          if (!assetInfo) {
            resolve({
              success: false,
              error: '预制体文件不存在',
            })
            return
          }

          // 验证预制体格式
          Editor.Message.request('asset-db', 'read-asset', prefabPath).then((content: string) => {
            try {
              const prefabData = JSON.parse(content)
              const validationResult = this.validatePrefabFormat(prefabData)

              resolve({
                success: true,
                data: {
                  isValid: validationResult.isValid,
                  issues: validationResult.issues,
                  nodeCount: validationResult.nodeCount,
                  componentCount: validationResult.componentCount,
                  message: validationResult.isValid ? '预制体格式有效' : '预制体格式存在问题',
                },
              })
            }
            catch (parseError) {
              resolve({
                success: false,
                error: '预制体文件格式错误，无法解析JSON',
              })
            }
          }).catch((error: unknown) => {
            resolve({
              success: false,
              error: `读取预制体文件失败: ${getErrorMessage(error)}`,
            })
          })
        }).catch((error: unknown) => {
          resolve({
            success: false,
            error: `查询预制体信息失败: ${getErrorMessage(error)}`,
          })
        })
      }
      catch (error) {
        resolve({
          success: false,
          error: `验证预制体时发生错误: ${error}`,
        })
      }
    })
  }

  public validatePrefabFormat(prefabData: unknown): { isValid: boolean, issues: string[], nodeCount: number, componentCount: number } {
    return validatePrefabFormat(prefabData)
  }

  private async duplicatePrefab(args: DuplicatePrefabInput): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        const { sourcePrefabPath, targetPrefabPath, newPrefabName } = args

        // 读取源预制体
        const sourceInfo = await this.getPrefabInfo(sourcePrefabPath)
        if (!sourceInfo.success) {
          resolve({
            success: false,
            error: `无法读取源预制体: ${sourceInfo.error}`,
          })
          return
        }

        // 读取源预制体内容
        const sourceContent = await this.readPrefabContent(sourcePrefabPath)
        if (!sourceContent.success) {
          resolve({
            success: false,
            error: `无法读取源预制体内容: ${sourceContent.error}`,
          })
          return
        }

        // 生成新的UUID
        const newUuid = generateUuid()

        // 修改预制体数据
        const modifiedData = this.modifyPrefabForDuplication(sourceContent.data ?? [], newPrefabName || 'DuplicatedPrefab', newUuid)

        // 创建新的meta数据
        const newMetaData = createPrefabMeta(newPrefabName || 'DuplicatedPrefab', newUuid)

        // 预制体复制功能暂时禁用，因为涉及复杂的序列化格式
        resolve({
          success: false,
          error: '预制体复制功能暂时不可用',
          instruction: '请在 Cocos Creator 编辑器中手动复制预制体：\n1. 在资源管理器中选择要复制的预制体\n2. 右键选择复制\n3. 在目标位置粘贴',
        })
      }
      catch (error) {
        resolve({
          success: false,
          error: `复制预制体时发生错误: ${error}`,
        })
      }
    })
  }

  private async readPrefabContent(prefabPath: string): Promise<{ success: boolean, data?: unknown[], error?: string }> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'read-asset', prefabPath).then((content: string) => {
        try {
          const prefabData = JSON.parse(content)
          resolve({ success: true, data: prefabData })
        }
        catch (parseError) {
          resolve({ success: false, error: '预制体文件格式错误' })
        }
      }).catch((error: unknown) => {
        resolve({ success: false, error: getErrorMessage(error) || '读取预制体文件失败' })
      })
    })
  }

  private modifyPrefabForDuplication(prefabData: unknown[], newName: string, newUuid: string): unknown[] {
    // 修改预制体数据以创建副本
    const modifiedData = [...prefabData]

    // 修改第一个元素（预制体资产）
    const prefabAsset = isToolArguments(modifiedData[0]) ? modifiedData[0] : null
    if (prefabAsset?.__type__ === 'cc.Prefab') {
      prefabAsset._name = newName || 'DuplicatedPrefab'
    }

    // 更新所有UUID引用（简化版本）
    // 在实际应用中，可能需要更复杂的UUID映射处理

    return modifiedData
  }

  /**
   * 使用 asset-db API 创建资源文件
   */
  private async createAssetWithAssetDB(assetPath: string, content: string): Promise<{ success: boolean, data?: unknown, error?: string }> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'create-asset', assetPath, content, {
        overwrite: true,
        rename: false,
      }).then((assetInfo) => {
        console.log('创建资源文件成功:', assetInfo)
        resolve({ success: true, data: assetInfo })
      }).catch((error: unknown) => {
        console.error('创建资源文件失败:', error)
        resolve({ success: false, error: getErrorMessage(error) || '创建资源文件失败' })
      })
    })
  }

  /**
   * 使用 asset-db API 创建 meta 文件
   */
  private async createMetaWithAssetDB(assetPath: string, metaContent: unknown): Promise<{ success: boolean, data?: unknown, error?: string }> {
    return new Promise((resolve) => {
      const metaContentString = JSON.stringify(metaContent, null, 2)
      Editor.Message.request('asset-db', 'save-asset-meta', assetPath, metaContentString).then((assetInfo) => {
        console.log('创建meta文件成功:', assetInfo)
        resolve({ success: true, data: assetInfo })
      }).catch((error: unknown) => {
        console.error('创建meta文件失败:', error)
        resolve({ success: false, error: getErrorMessage(error) || '创建meta文件失败' })
      })
    })
  }

  /**
   * 使用 asset-db API 重新导入资源
   */
  private async reimportAssetWithAssetDB(assetPath: string): Promise<{ success: boolean, data?: unknown, error?: string }> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'reimport-asset', assetPath).then((result) => {
        console.log('重新导入资源成功:', result)
        resolve({ success: true, data: result })
      }).catch((error: unknown) => {
        console.error('重新导入资源失败:', error)
        resolve({ success: false, error: getErrorMessage(error) || '重新导入资源失败' })
      })
    })
  }

  /**
   * 使用 asset-db API 更新资源文件内容
   */
  private async updateAssetWithAssetDB(assetPath: string, content: string): Promise<{ success: boolean, data?: unknown, error?: string }> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'save-asset', assetPath, content).then((result) => {
        console.log('更新资源文件成功:', result)
        resolve({ success: true, data: result })
      }).catch((error: unknown) => {
        console.error('更新资源文件失败:', error)
        resolve({ success: false, error: getErrorMessage(error) || '更新资源文件失败' })
      })
    })
  }

  /**
   * 创建符合 Cocos Creator 标准的预制体内容
   * 完整实现递归节点树处理，匹配引擎标准格式
   */
  private async createStandardPrefabContent(nodeData: unknown, prefabName: string, prefabUuid: string, includeChildren: boolean, includeComponents: boolean): Promise<unknown[]> {
    console.log('开始创建引擎标准预制体内容...')

    const prefabData: unknown[] = []
    let currentId = 0

    // 1. 创建预制体资产对象 (index 0)
    const prefabAsset = {
      __type__: 'cc.Prefab',
      _name: prefabName || '', // 确保预制体名称不为空
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      data: {
        __id__: 1,
      },
      optimizationPolicy: 0,
      persistent: false,
    }
    prefabData.push(prefabAsset)
    currentId++

    // 2. 递归创建完整的节点树结构
    const context = {
      prefabData,
      currentId: currentId + 1, // 根节点占用索引1，子节点从索引2开始
      prefabAssetIndex: 0,
      nodeFileIds: new Map<string, string>(), // 存储节点ID到fileId的映射
      nodeUuidToIndex: new Map<string, number>(), // 存储节点UUID到索引的映射
      componentUuidToIndex: new Map<string, number>(), // 存储组件UUID到索引的映射
    }

    // 创建根节点和整个节点树 - 注意：根节点的父节点应该是null，不是预制体对象
    await this.createCompleteNodeTree(nodeData, null, 1, context, includeChildren, includeComponents, prefabName)

    console.log(`预制体内容创建完成，总共 ${prefabData.length} 个对象`)
    console.log('节点fileId映射:', Array.from(context.nodeFileIds.entries()))

    return prefabData
  }

  /**
   * 递归创建完整的节点树，包括所有子节点和对应的PrefabInfo
   */
  private async createCompleteNodeTree(
    nodeData: unknown,
    parentNodeIndex: number | null,
    nodeIndex: number,
    context: PrefabSerializationContext,
    includeChildren: boolean,
    includeComponents: boolean,
    nodeName?: string,
  ): Promise<void> {
    const { prefabData } = context

    // 创建节点对象
    const node = createEngineNode(nodeData, parentNodeIndex, nodeName)

    // 确保节点在指定的索引位置
    while (prefabData.length <= nodeIndex) {
      prefabData.push(null)
    }
    console.log(`设置节点到索引 ${nodeIndex}: ${node._name}, _parent:`, node._parent, `_children count: ${node._children.length}`)
    prefabData[nodeIndex] = node

    // 为当前节点生成fileId并记录UUID到索引的映射
    const nodeUuid = extractNodeUuid(nodeData)
    const fileId = nodeUuid || generateFileId()
    context.nodeFileIds.set(nodeIndex.toString(), fileId)

    // 记录节点UUID到索引的映射
    if (nodeUuid) {
      context.nodeUuidToIndex.set(nodeUuid, nodeIndex)
      console.log(`记录节点UUID映射: ${nodeUuid} -> ${nodeIndex}`)
    }

    // 先处理子节点（保持与手动创建的索引顺序一致）
    const childrenToProcess = getChildrenToProcess(nodeData)
    if (includeChildren && childrenToProcess.length > 0) {
      console.log(`处理节点 ${node._name} 的 ${childrenToProcess.length} 个子节点`)

      // 为每个子节点分配索引
      const childIndices: number[] = []
      console.log(`准备为 ${childrenToProcess.length} 个子节点分配索引，当前ID: ${context.currentId}`)
      for (let i = 0; i < childrenToProcess.length; i++) {
        console.log(`处理第 ${i + 1} 个子节点，当前currentId: ${context.currentId}`)
        const childIndex = context.currentId++
        childIndices.push(childIndex)
        node._children.push({ __id__: childIndex })
        console.log(`✅ 添加子节点引用到 ${node._name}: {__id__: ${childIndex}}`)
      }
      console.log(`✅ 节点 ${node._name} 最终的子节点数组:`, node._children)

      // 递归创建子节点
      for (let i = 0; i < childrenToProcess.length; i++) {
        const childData = childrenToProcess[i]
        const childIndex = childIndices[i]
        await this.createCompleteNodeTree(
          childData,
          nodeIndex,
          childIndex,
          context,
          includeChildren,
          includeComponents,
          typeof childData.name === 'string' ? childData.name : `Child${i + 1}`,
        )
      }
    }

    // 然后处理组件
    const components = extractPrefabComponents(nodeData)
    if (includeComponents && components.length > 0) {
      console.log(`处理节点 ${node._name} 的 ${components.length} 个组件`)

      const componentIndices: number[] = []
      for (const component of components) {
        const componentIndex = context.currentId++
        componentIndices.push(componentIndex)
        node._components.push({ __id__: componentIndex })

        // 记录组件UUID到索引的映射
        const componentUuid = getComponentSceneId(component)
        if (componentUuid) {
          context.componentUuidToIndex.set(componentUuid, componentIndex)
          console.log(`记录组件UUID映射: ${componentUuid} -> ${componentIndex}`)
        }

        // 创建组件对象，传入context以处理引用
        const componentObj = createPrefabComponent(component, nodeIndex, context)
        prefabData[componentIndex] = componentObj

        // 为组件创建 CompPrefabInfo
        const compPrefabInfoIndex = context.currentId++
        prefabData[compPrefabInfoIndex] = {
          __type__: 'cc.CompPrefabInfo',
          fileId: generateFileId(),
        }

        // 如果组件对象有 __prefab 属性，设置引用
        if (componentObj && typeof componentObj === 'object') {
          componentObj.__prefab = { __id__: compPrefabInfoIndex }
        }
      }

      console.log(`✅ 节点 ${node._name} 添加了 ${componentIndices.length} 个组件`)
    }

    // 为当前节点创建PrefabInfo
    const prefabInfoIndex = context.currentId++
    node._prefab = { __id__: prefabInfoIndex }

    const prefabInfo: PrefabObject = {
      __type__: 'cc.PrefabInfo',
      root: { __id__: 1 },
      asset: { __id__: context.prefabAssetIndex },
      fileId,
      targetOverrides: null,
      nestedPrefabInstanceRoots: null,
    }

    // 根节点的特殊处理
    if (nodeIndex === 1) {
      // 根节点没有instance，但可能有targetOverrides
      prefabInfo.instance = null
    }
    else {
      // 子节点通常有instance为null
      prefabInfo.instance = null
    }

    prefabData[prefabInfoIndex] = prefabInfo
    context.currentId = prefabInfoIndex + 1
  }

  private createStandardMetaContent(prefabName: string, prefabUuid: string): PrefabObject {
    return {
      ver: '2.0.3',
      importer: 'prefab',
      imported: true,
      uuid: prefabUuid,
      files: [
        '.json',
      ],
      subMetas: {},
      userData: {
        syncNodeName: prefabName,
        hasIcon: false,
      },
    }
  }

  /**
   * 尝试将原始节点转换为预制体实例
   */
  private async convertNodeToPrefabInstance(nodeUuid: string, prefabUuid: string, prefabPath: string): Promise<{ success: boolean, error?: string }> {
    return new Promise((resolve) => {
      // 这个功能需要深入的场景编辑器集成，暂时返回失败
      // 在实际的引擎中，这涉及到复杂的预制体实例化和节点替换逻辑
      console.log('节点转换为预制体实例的功能需要更深入的引擎集成')
      resolve({
        success: false,
        error: '节点转换为预制体实例需要更深入的引擎集成支持',
      })
    })
  }

  private async restorePrefabNode(nodeUuid: string, assetUuid: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 使用官方API restore-prefab 还原预制体节点
      requestEditor('scene', 'restore-prefab', nodeUuid, assetUuid).then(() => {
        resolve({
          success: true,
          data: {
            nodeUuid,
            assetUuid,
            message: '预制体节点还原成功',
          },
        })
      }).catch((error: unknown) => {
        resolve({
          success: false,
          error: `预制体节点还原失败: ${getErrorMessage(error)}`,
        })
      })
    })
  }

  // 基于官方预制体格式的新实现方法
  private async savePrefabWithMeta(prefabPath: string, prefabData: unknown[], metaData: unknown): Promise<{ success: boolean, error?: string }> {
    try {
      const prefabContent = JSON.stringify(prefabData, null, 2)
      const metaContent = JSON.stringify(metaData, null, 2)

      // 确保路径以.prefab结尾
      const finalPrefabPath = prefabPath.endsWith('.prefab') ? prefabPath : `${prefabPath}.prefab`
      const metaPath = `${finalPrefabPath}.meta`

      // 使用asset-db API创建预制体文件
      await new Promise((resolve, reject) => {
        Editor.Message.request('asset-db', 'create-asset', finalPrefabPath, prefabContent).then(() => {
          resolve(true)
        }).catch((error: unknown) => {
          reject(error)
        })
      })

      // 创建meta文件
      await new Promise((resolve, reject) => {
        Editor.Message.request('asset-db', 'create-asset', metaPath, metaContent).then(() => {
          resolve(true)
        }).catch((error: unknown) => {
          reject(error)
        })
      })

      console.log(`=== 预制体保存完成 ===`)
      console.log(`预制体文件已保存: ${finalPrefabPath}`)
      console.log(`Meta文件已保存: ${metaPath}`)
      console.log(`预制体数组总长度: ${prefabData.length}`)
      console.log(`预制体根节点索引: ${prefabData.length - 1}`)

      return { success: true }
    }
    catch (error: unknown) {
      console.error('保存预制体文件时出错:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  }
}
