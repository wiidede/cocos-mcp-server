export function filterAssetsByName(assets: Record<string, unknown>[], name: string, exactMatch: boolean, maxResults: number): Record<string, unknown>[] {
  const query = name.toLocaleLowerCase()
  const matches: Record<string, unknown>[] = []
  for (const asset of assets) {
    const assetName = typeof asset.name === 'string' ? asset.name : ''
    if (exactMatch ? assetName === name : assetName.toLocaleLowerCase().includes(query)) {
      matches.push(asset)
      if (matches.length >= Math.max(0, maxResults))
        break
    }
  }
  return matches
}
