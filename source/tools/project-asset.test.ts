import { describe, expect, it } from 'vitest'
import { filterAssetsByName } from './project-asset'

describe('project asset filters', () => {
  const assets = [{ name: 'Player.png' }, { name: 'player.prefab' }, { name: 'Enemy' }, {}]

  it('supports case-insensitive partial matching and limits', () => {
    expect(filterAssetsByName(assets, 'PLAYER', false, 1)).toEqual([{ name: 'Player.png' }])
  })

  it('supports exact matching', () => {
    expect(filterAssetsByName(assets, 'player.prefab', true, 20)).toEqual([{ name: 'player.prefab' }])
  })
})
