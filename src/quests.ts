/**
 * The 11 quests, from the quest-select module of SYSTEM.INI (group 2, ENGLISH/SYSTEM.INI), quest number = sound bank Q00..Q10.
 * `areas` = number of exported stages of the quest (stages are numbered quest by quest, stage = first stage + area). The area
 * modules listed by the per-quest modules (sectors 4057..4073, slot +0x48) number 6, 10, 1, 10, 11, 10, 12, 3, 2, 2, 16 = 83;
 * five tiny ones (quest 4 area 10, quest 9 area 1, quest 10 areas 13-15) have no geometry of their own and are not exported,
 * which is why quests 4, 9 and 10 have 10, 1 and 13 stages here. Quest 0 = the inn (stage 0) plus its five rooms (stages 1-5).
 */
export const QUESTS: { name: string; areas: number }[] = [
  { name: 'The Roadside Inn', areas: 6 },
  { name: 'The Abandoned Mine', areas: 10 },
  { name: 'The Mountain of the Fire Dragon', areas: 1 },
  { name: 'The Wood of Ruins', areas: 10 },
  { name: 'The Old Palace', areas: 10 },
  { name: 'The Labyrinth of the Dead', areas: 10 },
  { name: 'The Palace of the Immortals', areas: 12 },
  { name: 'The Ancient Ruins', areas: 3 },
  { name: 'The Valley of White Silver', areas: 2 },
  { name: 'The Ruins in the Lake', areas: 1 },
  { name: 'The Sealed Cave', areas: 13 },
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
