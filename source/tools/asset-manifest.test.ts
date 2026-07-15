import { describe, expect, it } from 'vitest'
import { assetManifestToCsv, assetManifestToXml } from './asset-manifest'

describe('asset manifest formatting', () => {
  it('escapes CSV separators, quotes, and nested metadata', () => {
    expect(assetManifestToCsv([{ name: 'a,b', note: 'say "hi"', meta: { importer: 'image' } }])).toBe('name,note,meta\n"a,b","say ""hi""","{""importer"":""image""}"')
  })

  it('escapes XML text content', () => {
    expect(assetManifestToXml([{ name: 'A&B <C>' }])).toContain('<name>A&amp;B &lt;C&gt;</name>')
    expect(assetManifestToXml([])).toContain('<assets>\n</assets>')
  })
})
