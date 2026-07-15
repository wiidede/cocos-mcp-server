export type AssetManifestEntry = Record<string, unknown>

function stringifyValue(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')
}

function escapeCsv(value: unknown): string {
  const text = stringifyValue(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function escapeXml(value: unknown): string {
  return stringifyValue(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export function assetManifestToCsv(data: AssetManifestEntry[]): string {
  if (data.length === 0)
    return ''
  const headers = Object.keys(data[0])
  return [headers.map(escapeCsv).join(','), ...data.map(row => headers.map(header => escapeCsv(row[header])).join(','))].join('\n')
}

export function assetManifestToXml(data: AssetManifestEntry[]): string {
  const assets = data.map(item => `  <asset>\n${Object.entries(item).map(([key, value]) => `    <${key}>${escapeXml(value)}</${key}>`).join('\n')}\n  </asset>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<assets>\n${assets}${assets ? '\n' : ''}</assets>`
}
