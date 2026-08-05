// Player-facing changelog, shown in the Dev Log popover (ui/devLogPanel.ts).
// Deliberately short and written for players, not the internal build notes
// in _working/SESSION_LOG.md - add a new entry at the TOP of this array with
// each release.

export interface DevLogEntry {
  version: string
  date: string
  summary: string
  changes: string[]
}

export const DEV_LOG: DevLogEntry[] = [
  {
    version: 'Alpha 0.2',
    date: '2026-08-05',
    summary: 'Crits, a real Upgrades tab, and Buffers split into two types.',
    changes: [
      'New: Crit Chance and Crit Amount. Basic generators can now land a critical hit and produce a burst of extra value that tick.',
      "Basic generators no longer grow in value just by leveling up - leveling a Basic now raises its crit chance and crit amount instead. Buy the new Basic Generator Value and Generator Value % upgrades to grow raw value.",
      'Buff generators are now two types: Buff V1 (levels up to target more sides - 1, then 2 opposite, then all 4) and Buff V2 (buffs every Basic on the board at once, but starts expensive).',
      'New Upgrades tab: Tick Speed, Basic Generator Value, Generator Value %, Crit Chance, Crit Amount, and Removal Refund.',
      'Upgrade/Remove buttons now stay in a fixed spot instead of moving around depending on what you have selected.',
      'Added this Dev Log.',
    ],
  },
  {
    version: 'Alpha 0.1',
    date: '2026-08-04',
    summary: 'First playable version, deployed live.',
    changes: [
      'Place Basic, Leech, and Buff generators on a grid and start earning currency.',
      "Leveling a Leech widens its range - from its orthogonal neighbors, to a full ring around it, to the whole board.",
      'Save/load with offline progress calculated instantly, no matter how long you were away.',
      'Stats tab and a first set of Achievements to chase.',
    ],
  },
]
