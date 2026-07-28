import type { ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { requestAssetDb, requestEditor } from '../editor-message'
import { assetManifestToCsv, assetManifestToXml } from './asset-manifest'
import { toolFailure } from './tool-response'

type ToolArguments = Record<string, unknown>

interface BatchImportInput extends ToolArguments {
  sourceDirectory: string
  targetDirectory: string
  fileFilter?: string[]
  recursive?: boolean
  overwrite?: boolean
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export class AssetAdvancedTools implements ToolExecutor {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'save_asset_meta',
        description: 'Save asset meta information',
        inputSchema: {
          type: 'object',
          properties: {
            urlOrUUID: {
              type: 'string',
              description: 'Asset URL or UUID',
            },
            content: {
              type: 'string',
              description: 'Asset meta serialized content string',
            },
          },
          required: ['urlOrUUID', 'content'],
        },
      },
      {
        name: 'generate_available_url',
        description: 'Generate an available URL based on input URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Asset URL to generate available URL for',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'query_asset_db_ready',
        description: 'Check if asset database is ready',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'open_asset_external',
        description: 'Open asset with external program',
        inputSchema: {
          type: 'object',
          properties: {
            urlOrUUID: {
              type: 'string',
              description: 'Asset URL or UUID to open',
            },
          },
          required: ['urlOrUUID'],
        },
      },
      {
        name: 'batch_import_assets',
        description: 'Import multiple assets in batch',
        inputSchema: {
          type: 'object',
          properties: {
            sourceDirectory: {
              type: 'string',
              description: 'Source directory path',
            },
            targetDirectory: {
              type: 'string',
              description: 'Target directory URL',
            },
            fileFilter: {
              type: 'array',
              items: { type: 'string' },
              description: 'File extensions to include (e.g., [".png", ".jpg"])',
              default: [],
            },
            recursive: {
              type: 'boolean',
              description: 'Include subdirectories',
              default: false,
            },
            overwrite: {
              type: 'boolean',
              description: 'Overwrite existing files',
              default: false,
            },
          },
          required: ['sourceDirectory', 'targetDirectory'],
        },
      },
      {
        name: 'batch_delete_assets',
        description: 'Delete multiple assets in batch',
        inputSchema: {
          type: 'object',
          properties: {
            urls: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of asset URLs to delete',
            },
          },
          required: ['urls'],
        },
      },
      {
        name: 'validate_asset_references',
        description: 'Validate asset references and find broken links',
        inputSchema: {
          type: 'object',
          properties: {
            directory: {
              type: 'string',
              description: 'Directory to validate (default: entire project)',
              default: 'db://assets',
            },
          },
        },
      },
      {
        name: 'get_asset_dependencies',
        description: 'Get asset dependency tree',
        inputSchema: {
          type: 'object',
          properties: {
            urlOrUUID: {
              type: 'string',
              description: 'Asset URL or UUID',
            },
            direction: {
              type: 'string',
              description: 'Dependency direction',
              enum: ['dependents', 'dependencies', 'both'],
              default: 'dependencies',
            },
          },
          required: ['urlOrUUID'],
        },
      },
      {
        name: 'get_unused_assets',
        description: 'Find unused assets in project',
        inputSchema: {
          type: 'object',
          properties: {
            directory: {
              type: 'string',
              description: 'Directory to scan (default: entire project)',
              default: 'db://assets',
            },
            excludeDirectories: {
              type: 'array',
              items: { type: 'string' },
              description: 'Directories to exclude from scan',
              default: [],
            },
          },
        },
      },
      {
        name: 'compress_textures',
        description: 'Batch compress texture assets',
        inputSchema: {
          type: 'object',
          properties: {
            directory: {
              type: 'string',
              description: 'Directory containing textures',
              default: 'db://assets',
            },
            format: {
              type: 'string',
              description: 'Compression format',
              enum: ['auto', 'jpg', 'png', 'webp'],
              default: 'auto',
            },
            quality: {
              type: 'number',
              description: 'Compression quality (0.1-1.0)',
              minimum: 0.1,
              maximum: 1.0,
              default: 0.8,
            },
          },
        },
      },
      {
        name: 'export_asset_manifest',
        description: 'Export asset manifest/inventory',
        inputSchema: {
          type: 'object',
          properties: {
            directory: {
              type: 'string',
              description: 'Directory to export manifest for',
              default: 'db://assets',
            },
            format: {
              type: 'string',
              description: 'Export format',
              enum: ['json', 'csv', 'xml'],
              default: 'json',
            },
            includeMetadata: {
              type: 'boolean',
              description: 'Include asset metadata',
              default: true,
            },
          },
        },
      },
      {
        name: 'create_default_spriteframe',
        description: 'Create a 1x1 (or custom size) solid-color PNG + SpriteFrame asset and return its UUID. '
          + 'Useful when the project has no texture assets yet (e.g. fresh project). '
          + 'Returns the SpriteFrame sub-asset UUID (the value to assign to cc.Sprite.spriteFrame).',
        inputSchema: {
          type: 'object',
          properties: {
            color: {
              type: 'string',
              description: 'CSS color (e.g. "#ffffff", "#ff0000", "red"). Default: white.',
              default: '#ffffff',
            },
            size: {
              type: 'number',
              description: 'Edge size in pixels (1, 2, 4, 8, 16, 32, ...). Default: 4.',
              default: 4,
              minimum: 1,
              maximum: 1024,
            },
            savePath: {
              type: 'string',
              description: 'Where to write the PNG. Default: db://assets/__default_textures__/white_{hex}.png',
            },
          },
        },
      },
    ]
  }

  async execute(toolName: string, args: unknown): Promise<ToolResponse> {
    if (!isToolArguments(args)) {
      return toolFailure('Tool arguments must be a JSON object')
    }

    switch (toolName) {
      case 'save_asset_meta':
        return typeof args.urlOrUUID === 'string' && typeof args.content === 'string'
          ? this.saveAssetMeta(args.urlOrUUID, args.content)
          : toolFailure('save_asset_meta requires urlOrUUID and content strings')
      case 'generate_available_url':
        return typeof args.url === 'string' ? this.generateAvailableUrl(args.url) : toolFailure('generate_available_url requires a url')
      case 'query_asset_db_ready':
        return this.queryAssetDbReady()
      case 'open_asset_external':
        return typeof args.urlOrUUID === 'string' ? this.openAssetExternal(args.urlOrUUID) : toolFailure('open_asset_external requires urlOrUUID')
      case 'batch_import_assets':
        return typeof args.sourceDirectory === 'string' && typeof args.targetDirectory === 'string'
          && (args.fileFilter === undefined || isStringArray(args.fileFilter))
          && (args.recursive === undefined || typeof args.recursive === 'boolean')
          && (args.overwrite === undefined || typeof args.overwrite === 'boolean')
          ? this.batchImportAssets(args as BatchImportInput)
          : toolFailure('batch_import_assets requires sourceDirectory and targetDirectory strings')
      case 'batch_delete_assets':
        return isStringArray(args.urls) ? this.batchDeleteAssets(args.urls) : toolFailure('batch_delete_assets requires a urls string array')
      case 'validate_asset_references':
        return args.directory === undefined || typeof args.directory === 'string'
          ? this.validateAssetReferences(args.directory)
          : toolFailure('validate_asset_references directory must be a string when provided')
      case 'get_asset_dependencies':
        return typeof args.urlOrUUID === 'string' && (args.direction === undefined || typeof args.direction === 'string')
          ? this.getAssetDependencies(args.urlOrUUID, args.direction)
          : toolFailure('get_asset_dependencies requires urlOrUUID and an optional direction string')
      case 'get_unused_assets':
        return (args.directory === undefined || typeof args.directory === 'string')
          && (args.excludeDirectories === undefined || isStringArray(args.excludeDirectories))
          ? this.getUnusedAssets(args.directory, args.excludeDirectories)
          : toolFailure('get_unused_assets accepts optional directory and excludeDirectories string array')
      case 'compress_textures':
        return (args.directory === undefined || typeof args.directory === 'string')
          && (args.format === undefined || typeof args.format === 'string')
          && (args.quality === undefined || typeof args.quality === 'number')
          ? this.compressTextures(args.directory, args.format, args.quality)
          : toolFailure('compress_textures accepts optional directory, format, and numeric quality')
      case 'export_asset_manifest':
        return (args.directory === undefined || typeof args.directory === 'string')
          && (args.format === undefined || typeof args.format === 'string')
          && (args.includeMetadata === undefined || typeof args.includeMetadata === 'boolean')
          ? this.exportAssetManifest(args.directory, args.format, args.includeMetadata)
          : toolFailure('export_asset_manifest accepts optional directory, format, and includeMetadata')
      case 'create_default_spriteframe':
        return (args.color === undefined || typeof args.color === 'string')
          && (args.size === undefined || typeof args.size === 'number')
          && (args.savePath === undefined || typeof args.savePath === 'string')
          ? this.createDefaultSpriteframe(args.color, args.size, args.savePath)
          : toolFailure('create_default_spriteframe accepts optional color, size, and savePath')
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async saveAssetMeta(urlOrUUID: string, content: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'save-asset-meta', urlOrUUID, content).then((result) => {
        resolve({
          success: true,
          data: {
            uuid: result?.uuid,
            url: result?.url,
            message: 'Asset meta saved successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async generateAvailableUrl(url: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'generate-available-url', url).then((availableUrl: string) => {
        resolve({
          success: true,
          data: {
            originalUrl: url,
            availableUrl,
            message: availableUrl === url
              ? 'URL is available'
              : 'Generated new available URL',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async queryAssetDbReady(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'query-ready').then((ready: boolean) => {
        resolve({
          success: true,
          data: {
            ready,
            message: ready ? 'Asset database is ready' : 'Asset database is not ready',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async openAssetExternal(urlOrUUID: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('asset-db', 'open-asset', urlOrUUID).then(() => {
        resolve({
          success: true,
          message: 'Asset opened with external program',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async batchImportAssets(args: BatchImportInput): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        if (!fs.existsSync(args.sourceDirectory)) {
          resolve({ success: false, error: 'Source directory does not exist' })
          return
        }

        const files = this.getFilesFromDirectory(
          args.sourceDirectory,
          args.fileFilter || [],
          args.recursive || false,
        )

        const importResults: Record<string, unknown>[] = []
        let successCount = 0
        let errorCount = 0

        for (const filePath of files) {
          try {
            const fileName = path.basename(filePath)
            const targetPath = `${args.targetDirectory}/${fileName}`

            const result = await Editor.Message.request('asset-db', 'import-asset', filePath, targetPath, {
              overwrite: args.overwrite || false,
              rename: !(args.overwrite || false),
            })

            importResults.push({
              source: filePath,
              target: targetPath,
              success: true,
              uuid: result?.uuid,
            })
            successCount++
          }
          catch (err: unknown) {
            importResults.push({
              source: filePath,
              success: false,
              error: getErrorMessage(err),
            })
            errorCount++
          }
        }

        resolve({
          success: true,
          data: {
            totalFiles: files.length,
            successCount,
            errorCount,
            results: importResults,
            message: `Batch import completed: ${successCount} success, ${errorCount} errors`,
          },
        })
      }
      catch (err: unknown) {
        resolve({ success: false, error: getErrorMessage(err) })
      }
    })
  }

  private getFilesFromDirectory(dirPath: string, fileFilter: string[], recursive: boolean): string[] {
    const files: string[] = []

    const items = fs.readdirSync(dirPath)

    for (const item of items) {
      const fullPath = path.join(dirPath, item)
      const stat = fs.statSync(fullPath)

      if (stat.isFile()) {
        if (fileFilter.length === 0 || fileFilter.some(ext => item.toLowerCase().endsWith(ext.toLowerCase()))) {
          files.push(fullPath)
        }
      }
      else if (stat.isDirectory() && recursive) {
        files.push(...this.getFilesFromDirectory(fullPath, fileFilter, recursive))
      }
    }

    return files
  }

  private async batchDeleteAssets(urls: string[]): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        const deleteResults: Record<string, unknown>[] = []
        let successCount = 0
        let errorCount = 0

        for (const url of urls) {
          try {
            await Editor.Message.request('asset-db', 'delete-asset', url)
            deleteResults.push({
              url,
              success: true,
            })
            successCount++
          }
          catch (err: unknown) {
            deleteResults.push({
              url,
              success: false,
              error: getErrorMessage(err),
            })
            errorCount++
          }
        }

        resolve({
          success: true,
          data: {
            totalAssets: urls.length,
            successCount,
            errorCount,
            results: deleteResults,
            message: `Batch delete completed: ${successCount} success, ${errorCount} errors`,
          },
        })
      }
      catch (err: unknown) {
        resolve({ success: false, error: getErrorMessage(err) })
      }
    })
  }

  private async validateAssetReferences(directory: string = 'db://assets'): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        // Get all assets in directory
        const assets = await Editor.Message.request('asset-db', 'query-assets', { pattern: `${directory}/**/*` })

        const brokenReferences: Record<string, unknown>[] = []
        const validReferences: Record<string, unknown>[] = []

        for (const asset of assets) {
          try {
            const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', asset.url)
            if (assetInfo) {
              validReferences.push({
                url: asset.url,
                uuid: asset.uuid,
                name: asset.name,
              })
            }
          }
          catch (err) {
            brokenReferences.push({
              url: asset.url,
              uuid: asset.uuid,
              name: asset.name,
              error: (err as Error).message,
            })
          }
        }

        resolve({
          success: true,
          data: {
            directory,
            totalAssets: assets.length,
            validReferences: validReferences.length,
            brokenReferences: brokenReferences.length,
            brokenAssets: brokenReferences,
            message: `Validation completed: ${brokenReferences.length} broken references found`,
          },
        })
      }
      catch (err: unknown) {
        resolve({ success: false, error: getErrorMessage(err) })
      }
    })
  }

  private async getAssetDependencies(urlOrUUID: string, direction: string = 'dependencies'): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // Note: This would require scene analysis or additional APIs not available in current documentation
      resolve({
        success: false,
        error: 'Asset dependency analysis requires additional APIs not available in current Cocos Creator MCP implementation. Consider using the Editor UI for dependency analysis.',
      })
    })
  }

  private async getUnusedAssets(directory: string = 'db://assets', excludeDirectories: string[] = []): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // Note: This would require comprehensive project analysis
      resolve({
        success: false,
        error: 'Unused asset detection requires comprehensive project analysis not available in current Cocos Creator MCP implementation. Consider using the Editor UI or third-party tools for unused asset detection.',
      })
    })
  }

  private async compressTextures(directory: string = 'db://assets', format: string = 'auto', quality: number = 0.8): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // Note: Texture compression would require image processing APIs
      resolve({
        success: false,
        error: 'Texture compression requires image processing capabilities not available in current Cocos Creator MCP implementation. Use the Editor\'s built-in texture compression settings or external tools.',
      })
    })
  }

  private async exportAssetManifest(directory: string = 'db://assets', format: string = 'json', includeMetadata: boolean = true): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        const assets = await Editor.Message.request('asset-db', 'query-assets', { pattern: `${directory}/**/*` })

        const manifest: Record<string, unknown>[] = []

        for (const asset of assets) {
          const assetRecord = asset as unknown as Record<string, unknown>
          const manifestEntry: Record<string, unknown> = {
            name: asset.name,
            url: asset.url,
            uuid: asset.uuid,
            type: asset.type,
            size: typeof assetRecord.size === 'number' ? assetRecord.size : 0,
            isDirectory: asset.isDirectory || false,
          }

          if (includeMetadata) {
            try {
              const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', asset.url)
              if (assetInfo && assetInfo.meta) {
                manifestEntry.meta = assetInfo.meta
              }
            }
            catch {
              // Skip metadata if not available
            }
          }

          manifest.push(manifestEntry)
        }

        let exportData: string
        switch (format) {
          case 'json':
            exportData = JSON.stringify(manifest, null, 2)
            break
          case 'csv':
            exportData = assetManifestToCsv(manifest)
            break
          case 'xml':
            exportData = assetManifestToXml(manifest)
            break
          default:
            exportData = JSON.stringify(manifest, null, 2)
        }

        resolve({
          success: true,
          data: {
            directory,
            format,
            assetCount: manifest.length,
            includeMetadata,
            manifest: exportData,
            message: `Asset manifest exported with ${manifest.length} assets`,
          },
        })
      }
      catch (err: unknown) {
        resolve({ success: false, error: getErrorMessage(err) })
      }
    })
  }

  // ====== create_default_spriteframe ======

  private parseColorToRGBA(input: string): [number, number, number, number] {
    const s = String(input ?? '').trim()
    // #rgb / #rrggbb / #rrggbbaa
    if (s.startsWith('#')) {
      let hex = s.slice(1)
      if (hex.length === 3)
        hex = hex.split('').map(c => c + c).join('')
      if (hex.length === 6)
        hex += 'ff'
      if (hex.length !== 8)
        throw new Error(`Invalid hex color: ${input}`)
      const r = Number.parseInt(hex.slice(0, 2), 16)
      const g = Number.parseInt(hex.slice(2, 4), 16)
      const b = Number.parseInt(hex.slice(4, 6), 16)
      const a = Number.parseInt(hex.slice(6, 8), 16)
      return [r, g, b, a]
    }
    // named colors (minimal set)
    const named: Record<string, [number, number, number, number]> = {
      white: [255, 255, 255, 255],
      black: [0, 0, 0, 255],
      red: [255, 0, 0, 255],
      green: [0, 255, 0, 255],
      blue: [0, 0, 255, 255],
      yellow: [255, 255, 0, 255],
      cyan: [0, 255, 255, 255],
      magenta: [255, 0, 255, 255],
      gray: [128, 128, 128, 255],
      grey: [128, 128, 128, 255],
    }
    const lower = s.toLowerCase()
    if (named[lower])
      return named[lower]
    throw new Error(`Unsupported color: ${input}. Use #RRGGBB, #RRGGBBAA, or a CSS name (white/black/red/green/blue/yellow/cyan/magenta/gray).`)
  }

  /**
   * Generate a solid-color PNG of NxN pixels.
   * Returns a Buffer containing the full PNG file.
   */
  private buildSolidPNG(size: number, r: number, g: number, b: number, a: number): Buffer {
    // CRC32 table
    const crcTable: number[] = Array.from({ length: 256 })
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      crcTable[n] = c >>> 0
    }
    const crc32 = (buf: Buffer): number => {
      let c = 0xFFFFFFFF
      for (let i = 0; i < buf.length; i++) c = (crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)) >>> 0
      return (c ^ 0xFFFFFFFF) >>> 0
    }
    const chunk = (type: string, data: Buffer): Buffer => {
      const len = Buffer.alloc(4)
      len.writeUInt32BE(data.length, 0)
      const typeBuf = Buffer.from(type, 'ascii')
      const crcBuf = Buffer.alloc(4)
      crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
      return Buffer.concat([len, typeBuf, data, crcBuf])
    }
    // IHDR
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(size, 0) // width
    ihdr.writeUInt32BE(size, 4) // height
    ihdr.writeUInt8(8, 8) // bit depth
    ihdr.writeUInt8(6, 9) // color type 6 = RGBA
    ihdr.writeUInt8(0, 10) // compression
    ihdr.writeUInt8(0, 11) // filter
    ihdr.writeUInt8(0, 12) // interlace
    // Scanlines: each row prefixed with filter byte 0, then RGBA
    const row = Buffer.alloc(1 + size * 4)
    row[0] = 0
    for (let x = 0; x < size; x++) {
      const o = 1 + x * 4
      row[o] = r
      row[o + 1] = g
      row[o + 2] = b
      row[o + 3] = a
    }
    const scanlines: Buffer[] = []
    for (let n = 0; n < size; n++) scanlines.push(row)
    const raw = Buffer.concat(scanlines)
    const idatData = zlib.deflateSync(raw)
    // Assemble
    const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    return Buffer.concat([
      sig,
      chunk('IHDR', ihdr),
      chunk('IDAT', idatData),
      chunk('IEND', Buffer.alloc(0)),
    ])
  }

  private async createDefaultSpriteframe(color: string = '#ffffff', size: number = 4, savePath?: string): Promise<ToolResponse> {
    try {
      const [r, g, b, a] = this.parseColorToRGBA(color)
      const hex = `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      const targetPath = savePath || `db://assets/__default_textures__/white_${hex}_${size}px.png`
      const buffer = this.buildSolidPNG(size, r, g, b, a)
      // Resolve project absolute path. Editor.Project.path is the canonical way in Cocos Creator.
      // Fall back to legacy asset-db message if needed.
      let projectPath: string | undefined = Editor.Project.path
      if (!projectPath) {
        try {
          const info = await requestAssetDb('query-asset-info', 'db://assets')
          if (typeof info?.file === 'string')
            projectPath = path.dirname(info.file)
        }
        catch { /* ignore */ }
      }
      if (!projectPath) {
        try {
          const info = await requestEditor('asset-db', 'get-db-info')
          if (isToolArguments(info) && typeof info.projectPath === 'string')
            projectPath = info.projectPath
        }
        catch { /* ignore */ }
      }
      if (!projectPath) {
        throw new Error('Cannot resolve project path (Editor.Project.path and asset-db queries all failed)')
      }
      const absPath = path.join(projectPath, targetPath.replace(/^db:\/\/assets\//, 'assets/'))
      // Ensure dir exists
      fs.mkdirSync(path.dirname(absPath), { recursive: true })
      // 幂等化：如果文件已存在且内容完全一致，跳过 write + refresh，直接 query
      let sameContent = false
      if (fs.existsSync(absPath)) {
        try {
          const existing = fs.readFileSync(absPath)
          if (Buffer.isBuffer(existing) && existing.equals(buffer)) {
            sameContent = true
          }
        }
        catch { /* ignore read errors, fall through to write */ }
      }
      if (!sameContent) {
        fs.writeFileSync(absPath, buffer)
        // A direct filesystem write is not guaranteed to be picked up by the
        // asset-db watcher immediately. Use the targeted refresh-asset route;
        // unlike the old broad refresh message, it does not reload the active
        // scene/editor context.
        await requestAssetDb('refresh-asset', targetPath)
      }
      // Wait for import (poll up to 5s)
      let info = await requestAssetDb('query-asset-info', targetPath).catch(() => null)
      for (let i = 0; i < 25; i++) {
        await new Promise(res => setTimeout(res, 200))
        try {
          info = await requestAssetDb('query-asset-info', targetPath)
          if (info && info.uuid)
            break
        }
        catch { /* not ready yet */ }
      }
      if (!info || !info.uuid) {
        throw new Error(`Asset import timeout for ${targetPath}`)
      }
      // Find SpriteFrame sub-asset. subAssets can be:
      //   - undefined (single-asset files, e.g. .txt) → fallback below
      //   - Array<{ uuid, type, name, ... }> (newer Cocos)
      //   - Object<uuid, { uuid, type, name, ... }> (older Cocos)
      // Normalize to array first.
      let subAssetArr: Record<string, unknown>[] = []
      const rawSub = info.subAssets
      if (Array.isArray(rawSub)) {
        subAssetArr = rawSub.filter(isToolArguments)
      }
      else if (rawSub && typeof rawSub === 'object') {
        subAssetArr = Object.values(rawSub).filter(isToolArguments)
      }
      const spriteFrame = subAssetArr.find(item => item.type === 'cc.SpriteFrame')
        || subAssetArr.find(item => typeof item.name === 'string' && /sprite[-_]?frame/i.test(item.name))
      if (!spriteFrame || typeof spriteFrame.uuid !== 'string') {
        const fallbackUuid = `${info.uuid}@f9941`
        return {
          success: true,
          data: {
            pngPath: targetPath,
            pngUuid: info.uuid,
            spriteFrameUuid: fallbackUuid,
            color: { r, g, b, a },
            size,
            warning: 'SpriteFrame sub-asset not found by name; returned "{baseUuid}@f9941" fallback',
            cached: sameContent,
          },
        }
      }
      return {
        success: true,
        data: {
          pngPath: targetPath,
          pngUuid: info.uuid,
          spriteFrameUuid: spriteFrame.uuid,
          spriteFrameName: spriteFrame.name,
          color: { r, g, b, a },
          size,
          cached: sameContent,
        },
      }
    }
    catch (err: unknown) {
      return { success: false, error: getErrorMessage(err) }
    }
  }
}
