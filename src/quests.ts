/**
 * The 11 quests, from the quest-select module of SYSTEM.INI (group 2, ENGLISH/SYSTEM.INI) in the order of the sound banks
 * Q00..Q10. The number of areas per quest comes from the bank files (Q01_00..Q01_09 = 10 areas, ...); stages are numbered
 * quest by quest, so stage = first stage of the quest + area. Confirmed by the monsters of each range (undead in quests 5/6,
 * bats/scorpions in the Mine, ...).
 */
export const QUESTS: { name: string; areas: number }[] = [
  { name: 'The Roadside Inn', areas: 1 },
  { name: 'The Abandoned Mine', areas: 10 },
  { name: 'The Mountain of the Fire Dragon', areas: 1 },
  { name: 'The Wood of Ruins', areas: 10 },
  { name: 'The Old Palace', areas: 11 },
  { name: 'The Labyrinth of the Dead', areas: 10 },
  { name: 'The Palace of the Immortals', areas: 12 },
  { name: 'The Ancient Ruins', areas: 3 },
  { name: 'The Valley of White Silver', areas: 2 },
  { name: 'The Ruins in the Lake', areas: 2 },
  { name: 'The Sealed Cave', areas: 16 },
];

/** Quest number, its name and the area number of a stage (0-based), or null outside 0..77. */
export function questOf(stage: number): { quest: number; name: string; area: number; areas: number } | null {
  let first = 0;
  for (let q = 0; q < QUESTS.length; q++) {
    const n = QUESTS[q].areas;
    if (stage < first + n) return stage >= first ? { quest: q, name: QUESTS[q].name, area: stage - first, areas: n } : null;
    first += n;
  }
  return null;
}
