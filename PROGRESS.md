# Progress log

Goal: playable TypeScript/three.js web port of *Blaze & Blade: Eternal Quest* (Win EN). Repo will go private
later. Newest entry first; each work session appends here.

### Turn 9 (continues; notes after each step)

**Step AI – BLAZE.ALL inventory and embedded MIPS code.**
- `tools/inventory.py` classifies every sector by start signature: PACK 32.9%, MESH 28.2%, TEX8 20.2%, TEX9 11.8%, MODULE 3.3%, UNKNOWN 2.7% (620 sectors in 141 runs), ZERO 0.6%, FILL 0.2%. So about 97% of the file is accounted for.
- BLAZE.ALL contains **PS1 MIPS R3000 machine code** (588 sectors with several `sw ra / lw ra / jr ra / addiu sp` hits). Main block: sectors ~4649-5120 (densest 4720-4815, 4973-4983, 5082-5119). Overlay code blocks follow each quest group (e.g. 6021-6065, 6678-6730, 7113-7160 ...).
- `tools/mips.py` is an R3000 + GTE disassembler (`mips.py <file> <offset> <count> <load addr hex>`).
- Load address of the main block: file offset + 0x7f7397b0 (sector 4767 -> 0x80088fb0). Check: in 4720-4815, 475 of 665 in-range `jal` targets land on a function prologue; the same shift is consistent from ~4675 to ~5113. Sectors that do not fit (e.g. 4649-4661, 4973-4983, 5115-5120) are probably other segments or data. Overlay load addresses are still unknown.
- Sector 5098 (0x8012e7b0) is an object-update routine: reads a type at +0x14 (1..5), sets bits 0-4 in a flag word at 0x800cf69c, uses a jump table at 0x800d262c. It looks like per-object behaviour (pickups/switches?), not the door loader. Not yet confirmed.
- Dead ends: the many `lh 0x14(...)` sites in the main block (e.g. 0x800992dc) are runtime object fields (angle/sin-cos effects), not the map entity link. Sector 4644 is the (sector, size) table of monster/character packs, not warps. Searching for `lui 0xffff` and `li -1` next to a +0x14 read gives candidates in sectors 4773-4812 and 5084-5099, repeated in each quest overlay; not yet disassembled.
- **Master map tables found** (sectors 4058-4074, the 'global data modules' also hold these): each is a list of (sector, size) pairs. Sector 4058 = hub: 13 groups of 8 pairs = inn module + 5 room pairs + 2 filler (5569, 264) for each story variant (sectors 5548-5830). Sector 4060 = quest 1: one atlas pair (7909, 33312) then 10 map-module pairs (7926 ... 7975) matching stages 6-15. Further tables at 4062, 4064, 4066, 4069, 4070, 4071, 4074 for the later quests. So the stage-to-sector mapping is a table the code indexes; no stage sectors are hardcoded in code.
- Door `link` values (up to ~1400) are far larger than the number of maps, so they are event/script ids, not map indices. Many entity records with large `kind` values suggest my entity parse is misaligned for some stages (needs a recheck).
- **Entity records re-read (full 16 halfwords)**: `kind, sub, flag, 0, x, y, z, 0, rot, 0, id1, id2, id3, -1?, a, b`. `id1` (w10) and `id2` (w11) are values in one global id space (~0-1500) shared by chests (sequential, e.g. 896-916), doors, switches and triggers across all stages. `id1` repeats across entities of a stage (871 on many records of stage 9 with different `id2`), and `id2`/arrival ids match door ids in other stages about as often as chance does (the same id often appears in 3-4 stages). Conclusion: the ids are event/flag ids (door open state, chest taken, trigger groups), NOT destination pointers. A door's target is therefore not in its entity record.
- **UI images decoded** (`tools/export_ui.py` -> `public/assets/ui/`): sectors 62 and 91 are the two 128x224 RGB555 halves of the title screen (-> `title.png`, 256x224, incl. 'Push Start Button' and the (c)1998 T&E Soft / Funsoft credit lines); sector 4092 is the 128x256 8-bit font/HUD sheet (`hud.png`: BLOCK/FREE labels, digits, icons); sector 4009 is a 128x256 8-bit ornament sheet (`sheet4009.png`). All other 16-byte-header image records in the file are the known 16x16-palette atlases (270 of them).
- **16 extra hero animations found**: single-animation packs (`n=1`, blob header 0x40) at sectors 3826, 3828, 3829, 3831, 3833, 3834, 3836, 3838, 3840, 3842, 3844, 3846, 3847, 3849, 3851, 3853, not listed in `packs.json`. Their skeleton counts (A,B,C) match hero 0..15 in order (some have 1-2 bones more or fewer than the hero's normal animations, so each anim keeps its own `parent`/`partBone`). `tools/export_heroes.py` now appends each as the last entry of `anims` with `extra: true` (hero00 has 10 anims, others 9-10). Hero 0's has 12 distinct frames (sword-forward pose); hero 11's has 4 identical frames (a static pose). Their purpose (cutscene / character-select / ending?) is not yet known. A 17th pack at 2632 (counts 43,28,15, 15 frames) matches no hero.
- **8-bit texture pages exported** (Step AJ). Mode-9 records (`16, 9, 524`; 256-entry RGB555 CLUT at +0x14; `u16 w/2, u16 h` at +540; pixels at +544) come in 256x256 (66080 B), 256x64 (16928 B), 128x128 and smaller sizes. `tools/export_stages.py` writes them as `bSECTOR.png` (RGBA, 153 files) and each stage JSON now has `pages`: one entry per texture-list position, = 4-bit atlas index or 8-bit page name or null. This fixes a mis-index (`pg & 31` is the position in the FULL texture list, not in the 4-bit-only `atlases` list) and gives real textures to faces of stages 17 and 23 (water, 442 + 121 faces), 49 (a painting, 184), 72 (a lava page, 1871 of 3499 faces), 37/40/41/46 (a few). `stageViewer.ts` uses `pages` (8-bit pages are copied as coloured images into their slot; the palette-row choice is ignored for them).
- Stage 25's descriptor has no sentinel word, so its texture list was empty; `export_stages.py` now falls back to the pairs directly before the collision pair (5 4-bit atlases, one 8-bit 256x256 page at position 3, plus small pages). Stage 60's list was already complete.
- **Offline render check of the 8-bit pages** (stages 17, 49, 72): water in stage 17 and the painting in stage 49 look right. Stage 72's big ground plane had been given the 8-bit lava page by the old ground-plane guess (`pg = 1`); it now uses the second 4-bit atlas by texture-list position (palette 3, still a guess: it renders as red/blue noise, the real ground of that lava stage is probably a run-time-palette lava tile).
- Monster spawns: the spawner-like records (flag -95, sub 1, kind 0x2c02 in stage 9) look like zones (`a` = radius 750-3000, `b` = count 10-40 at `w[14]`, `w[15]`), but neither the kind's high or low byte matches the stage's monster list (checked over all 78 stages, 27 flag -95 records, 1 hit). Monster-to-spawn mapping is still only the existing heuristic in `play.ts`.
- Hero animation roles: slots 0-4, 6-8 were already confirmed by eye. Motion stats for hero 0: slot 0 is a near-loop (loop gap 185), 4 is a perfect loop (jump/idle-air?), 5 is a 7-frame one-shot with large steps (unknown, maybe defend/cast), 8 is a single frame; the extra pack animation (12 frames, loop gap 414) is a loop. `modelViewer.animCount` now excludes the extra animation (so slot 8 `victory` is not accidentally the extra one for the 8-pack heroes); the viewer's dropdown lists it as "extra pack, role unknown".
- **Map module structure (Step AK)**: module = 0x100-byte header (`256, A, B, 0`, then ~37 section offsets into the table part) + table part (A bytes, from +0x100) + body (to B; offsets in the sections run up to B). The module of a stage is the one just before the stage's descriptor sector (descriptors sit in modules at 10521+, 5548+ etc., NOT next to the stage geometry). Sections found in stage 18's module (10530): monster definitions (5 x 96 bytes: `char name[16]`, `u16[40]`, [0] = level, e.g. 'Lv6.Kobold', 'Kobold', 'Giant-Beetle', 'Wing-Fish', 'Giant-Club'), arrival records, pointer tables (59 pointers at +1300 into the body at 7860.., 58 pointers at +1556 into the text area at 10780..), `(pointer, kind<<8|n)` pairs at +984 (6, 0x107, 0x208, 0x309, 0x150e ...) and 8-byte tables with `0x20000000` flags: this looks like an object/event database for the script interpreter. The entity records (flag 0xff82 etc.) are in the body too. Arrival records are `u32 (a<<16|b) | y<<16|x | z | rot | 0xffff0000|id | -1`: `a` is constant per module (0x2f, 0x30 in stage 18; 0x6f/0x70 in the inn, +5 per story variant), `b` is 0,3,1,2 in stage 18 (arrival slot?). Not enough yet to decode door targets.
- `tools/export_stages.py` now writes `monsterDefs` (name, level, raw u16[40]) per stage (68 of 78 stages have them; first-quest example: 'Lv20.Goblin', 'Goblin-Shaman', 'Giant-Bat'); play mode shows them in the HUD ('here: ...'). The model-id to name mapping is ambiguous (stage `monsters` lists are incomplete, 17 of 68 models resolve to one name by intersection), so it is not used for spawning yet.
- Module text area (stage 18, from +10396): the map title ('- The Boathouse at Lakeside -'), ~15 pairs of 'It won't open. It must be locked.'-style door lines (each line stored twice, so there are two text slots per door/NPC), NPC remarks, and gate hints ('We can't get the boat out with the gate closed.'). So many -126 door entities are locked doors that open on a flag (their `link` = the flag id) and show a random locked line otherwise; the `(pointer, kind<<8|n)` pairs at +984 map entity kinds to these lines. This supports 'link = flag id' and means door destinations need the interpreter, not the data.
- **Monster stats (Step AL)**: in a definition record, `raw[2]` is HP (Red-Dragon 8000, Zombie-Dragon 4400, Death-Knight 240, Goblin 33, Kobold 14; 1 for multi-part/copy monsters like Kraken parts and the Doppelganger), `raw[0]` looks like level/EXP, `raw[16..23]` eight attack/defence-type values (`raw[16]` used as attack), `raw[6..9]` and `raw[10..15]` unknown. Model id -> name is solved in the exporter by constraint (a name must be in every stage that lists the model; models in one stage differ): 25 of 68 models resolve (3 Giant-Bat, 15 Lizard-Man, 23 Zombie, 39 Giant-Club, 40 Wing-Fish, 47 Gremlin, 49 Succubus ...). Stage JSON gets `monsterInfo` (model, name|null, level, hp, attack); play mode uses HP (clamped 20-300) and damage `attack/8` (3-25) when known, else the old 60 HP / 8 damage.
- **Script/object code, first pass (Step AL)**: the overlay/main-block code works on a runtime object struct held in `$s0`: `+0x10` state (the entity flag value: -255 is turned into 1, -2 / -1 / 0 / positive are branches), `+0x12` frame counter, `+0x14` type/angle (e.g. 0xca, 0xcd animation states), `+0x16` parameter, `+0x1c/+0x20/+0x24` position (y is shifted by 12), `+0x30` initial value, `+0x50/+0x54/+0x58` velocity, `+0x5c` counter, `+0x98/+0x9a` sign/magnitude. The object init/update routine at 0x80129de0 (sector 5088, also repeated in every overlay: the `li -255` sites at 0x80129df8, 0x8012dc34, 0x8012edd4) dispatches on the state; 0x800cf69c is a global flag word (bits 0-4 set by type 1..5 objects, probably key/switch bits). Door handling (locked-door text, warp) is not located yet: it would be one of the type handlers reached through the jump table at 0x800d262c (sector ~4913). Next step for the interpreter: dump that jump table, disassemble each handler, look for calls that load a map module (CD read with a sector from the 4058-4074 tables) or write a global `next map` variable.
- The jump table at 0x800d262c is all zeros in the file and the handler addresses (0x8012e87c ...) occur nowhere as data, so it is filled at run time; the handlers can only be found by following the code that builds it (look for stores to 0x800d262c+4*n or a `lui 0x800d / ori 0x262c` pair).
- **Interpreter hunt result (Step AL)**: the `lw 0x262c($at)` switch at 0x8012e864 is only the object-type 1..5 handler (each case ORs bit 0..4 into the flag word at 0x800cf69c, then falls into movement code); it is a particle/effect-style object update, not door or script logic. Its jump table (and the `0x800d26xx` words used elsewhere: 0x2604-0x2678) are globals/rodata that are zero in BLAZE.ALL, so they belong to the main executable image, which is not in this file. Searching for loads of the module offsets (+984, +1300, +1556, +1096, +1144) finds only 16 sites for +984 (sectors 4661-4704, 4877, 4977-4978) and none that read the pointer tables directly, so the module data is accessed through a base pointer plus computed offsets, not through fixed constants. Conclusion: door destinations cannot be read from BLAZE.ALL code alone without the main executable; the remaining route is data-driven (arrival-record `a`/`b` fields and per-stage `(pointer, kind<<8|n)` pairs).
- **Door data hunt, data side (Step AL)**: (1) Arrival ids are global and almost unique (60 distinct ids over the stages that have arrivals; only 118 and 86 repeat). (2) Searching every module for another stage's arrival id gives ~1900 hits, but nearly all are offset-table words in the global modules (4057-4073) and not references; the 505 hits inside stage 18 are the y-height of two 32-byte placement records (`kind 0xb00, n, x, y=505, z`), a false lead. (3) In the town stages an arrival sits about 120 units from a door (stage 1: 118 next to door id 98, stage 2: 169 next to door 133, stage 4: 129 near door 119), so an arrival is the spawn point beside the door you come through, but door `id1` (98, 133, 142, 119, 20 ...) is that door's own event/flag id and differs from the arrival id by no fixed amount (+20, +36, +10), so it is not the destination. (4) Dungeon doors (stage 18) have `id1 = -1` and nothing else in the record; their destination is not in the entity record. Still open: where (area, arrival id) pairs for each door live; the play-mode guess (exit door -> next stage, entrance door -> previous stage) stays.
- **Model->name solver, ordering rule (Step AL)**: a stage's streamed model list follows the order of its definition list (41 of 42 solved pairs agree, while model-id order does not), so the exporter now enumerates the in-order assignments that fit each model's candidate names, keeps only names that occur in a valid assignment, and repeats to a fixpoint. 52 of 88 model ids now resolve (was 25 of 68 by the plain set solver; none of the earlier answers changed), e.g. 1 Goblin, 2 Goblin-Shaman, 4 Giant-Snake, 5 Killer-Bear, 8 Giant-Scorpion, 9 Giant-Centipede, 14 Giant-Beetle, 20 Stalker, 21 Black-Knight, 25 Mummy, 31 Wolf, 54 Red-Dragon, 64 Vampire-Lord; 55 and 96 both come out as OwlBear (two models, one definition). Unresolved ids are mostly in the first quest hub areas (no definitions in those modules) and in stages whose model list is longer than the definitions.
- **Stage 72 ground (Step AL)**: the default ground guess (second 4-bit atlas, palette 3) put the metal-panel sheet on the floor of the volcano stage. Rendering the candidates offline showed atlas 255 (texture-list position 0) with palette 12 (or 13, which adds blue specks) is a plausible brown volcanic rock, so the exporter has a `GROUND_OVERRIDE = {72: (0, 12)}` table (position, palette) for stages where the default is clearly wrong. Still a guess: palette 0 of the ground sheets is filled at run time and its source was not found.
- **Hero anim slot 5 (Step AL)**: rendered hero 0 slot 5 frame by frame offline (7 frames): the sword is brought across the body horizontally and the pose is then held while the hero steps, unlike slot 3 (overhead slash) and slot 6 (low side slash). Best guess: guard/block. The viewer labels it `guard?`; play mode binds it to key G and halves enemy damage while it plays. Still unconfirmed (no use of the slot was found in code, so no way to check the game's own use).
- **Hero extra-pack animation (Step AL)**: rendered hero 0's 12 frames: arms hang at the sides, the sword is on the back and not in the hand (slot 0 idle holds it), body sways very slightly. Reads as a relaxed/unarmed idle (town or talking pose), unconfirmed. Play mode now uses it when the hero stands still with no hostile within 700 units; the viewer labels it `extra pack: relaxed idle ... guess`.
- **Blaze.exe look (Step AL)**: there is no PS1 executable on the disc image we have; the only main program is the Windows `bin/Blaze.exe` (PE32, image base 0x400000, `.text` 1.3 MB at VA 0x401000, file offset 0x400). It is native x86 (318 switch tables, thousands of small functions), imports 125 functions by ordinal from `winsys3d.dll` plus 9 from `WSYSKERN.dll`, among them `MainMem` (the emulated 2 MB PS1 RAM), so the game code runs against PS1-style memory. `playst.dll` (758 named exports: Gs*, Cd*, Ss*, DecDCT*) is the PS library re-implementation; Blaze.exe does not import it by name. Disassembly: `objdump -D -b binary -m i386 --adjust-vma=0x400c00 --start-address=0x401000 --stop-address=0x54c270 original/bin/Blaze.exe`. Searches that found nothing: immediates 0xff01 / 0xff82 (entity flags), the sector numbers of the global modules (0xfda...0xfea), direct references to the string `BLAZE.ALL;1` (only reached through a pointer at file offset 0x1651ac; the drive-finder at VA 0x51397c asks for the CD with `Please insert Blaze & Blade CD!`). The biggest dispatch is a 188-entry switch at VA 0x515194 (opcode byte, limit 0xbb) inside a block of thin wrappers at 0x513000-0x516000, probably the PS-library/BIOS shim, not the game script. No symbols, so finding the door code means following data (MainMem structure offsets) rather than names.
- **Following the data into Blaze.exe (Step AL)**: (1) Earlier "no hits" for 0xff01/0xff82 were a shell-quoting mistake; with correct quoting `cmpw $0xff01,0x10(%esi)` does occur: three copies of the object-init routine at VA 0x4502e0, ~0x450d30 and ~0x473ec0 (the same code as the three MIPS copies at 0x80129de0 / 0x8012dc14 / 0x8012edc0), so Blaze.exe is the game compiled from the same source and the MIPS code in BLAZE.ALL is the PS1 build of it. It sets state +0x10 (-255 -> 1, -2/-1/0 branches, 0xca) exactly as in MIPS. (2) A literal -126 (0xff82) is never compared anywhere in .text, so doors are not recognised by that flag value in code; the flag likely selects a generic class and the entity `kind/sub` words do the work. (3) Door-class records (flag -126, 1713 of them across stages) are not only doors (sub 5/8/15 are other triggers), and their `kind` is two bytes `hi,lo`: stage 2 (12,16) sub 9, stage 4 (17,18) sub 15, stage 6 (22,20) sub 15: hi +5, lo +2 per step (same +5 per story variant as the arrival `a` field). In the quest-1 stages every stage has one `(22, n) sub 15` record (n = 20, 7, 7, 10, 6, 8, 4 in stages 6, 7, 8, 9, 11, 12, 13) next to several `(0, n)` records with small n, which looks like a per-quest slot index, not a destination. (4) Most stages (all of 6-9, 11, 13 ...) have no arrival records of the form I decoded, so the arrival/door pairing only exists for some modules; the destination logic for the rest is elsewhere. Not solved; next is following the spawner (the code that walks 32-byte records) in Blaze.exe from the object-init routines upward.
- **Blaze.exe tables (Step AL)**: (1) The object-init routine at VA 0x4502e0 is only reached through a function-pointer table in .data: 11865 dword entries at VA 0x553288-0x55ebe8 (8975 point to one do-nothing stub 0x401fa0, 1110 to 0x4734b0), laid out as repeating blocks of 416 entries (e.g. the five shared handlers 0x4736d0/0x4738a0/0x473a90/0x473cb0/0x473a70 sit at offsets 34..39 of block after block, monster/area handlers differ per block), index 49 = 0x4502e0 and 50 = 0x450d30. So object behaviour is looked up by a class index; no direct caller references the table base, so the index computation still has to be found. (2) The 33-entry table at VA 0x55eb68 (handlers 0x5037d0-0x504c80, loop at 0x503777 `mov (%eax),%dl; call *0x55eb68(,%edx,4)`) is NOT a game script: the code masks `0xfc0000 == 0x800000` and walks `0x1b0000` buffers, i.e. it is the GPU command-packet interpreter of the PS1 emulation. (3) The 188-entry switch at 0x515194 belongs to the same shim. Conclusion so far: the door and map-change logic is somewhere in the class handlers (blocks of 416) and is reached by an index I have not decoded; static reading of unlabeled x86 handlers one by one is slow and each handler would still have to be tied to a record `kind/sub`.
- **Play-mode sound and retry (Step AM)**: `src/audio/sfx.ts` gives play mode eight sound slots (swing, hit, hurt, enemyDie, heroDie, jump, door, talk). The meaning of the Snd clips is unknown (8-bit PCM, no names; checked they are smooth audio, adjacent-sample correlation 0.7-0.9, so the decode is right), so the defaults are guesses from clip length / noisiness / attack (all in bank `Base`: 7, 29, 11, 31, 32, 2, 38, 1). The sound browser has a slot selector and an "assign current clip" button; assignments are kept in localStorage and replace the defaults; there is a mute box. After dying, R / Enter / touch restarts the current area with full HP (before, you had to leave play mode).
- **Healing potions (Step AM)**: play mode starts with 3 Healing Potions (every starting kit has one; the kit-to-hero mapping and the heal amount are not decoded, so 40 HP is a guess), key P or the potion button, shown in the HUD; they carry over doors and retries and reset on a new play session.
- **Minimap (Step AM)**: play mode draws a 140 px minimap top-right: floor triangles (offscreen, built per area), yellow = doors, red = enemies, blue = NPCs, green = hero with a line for the camera's forward direction; north-up. Not run in a browser (no three.js in the sandbox), only type-checked.
- **Hero classes decoded (Step AM)**: the character-select module (sector 4633) lists the 16 classes in order: Warrior (m), Priest, Rogue (m), Sorcerer, Hunter (m), Elf (m), Dwarf (m), Fairy (m), then the same eight as (f). This matches the hero model numbers 0..15 (rendered hero 1 = robed priest, 3 = sorcerer, 4 = hunter, 8 = armoured woman) and the eight starting kits (kit k = class k, shared by the m/f pair: sword+leather armor+shield, club+robe, dagger, wooden wand+robe, shortbow, shortsword, tomahawk+shield, rod+robe; each also has a Healing Potion). Item record byte +18 is a class bit mask (1 warrior ... 128 fairy), +48 weapon attack (7, 5, 5, 5, 5, 6, 8, 5), +54 armor/shield value used as defence. `tools/export_classes.py` writes `public/assets/heroes/classes.json`; the hero dropdown shows class names and play mode uses weapon attack x 5 as damage per hit and half the armor value as flat damage reduction (guesses for the scaling).
- Immediate-constant search for the door `link` ids and the -126 entity flag found nothing conclusive yet. Next: follow the entity-record reader (32-byte stride, link at +0x14) and the dialogue interpreter in the code.
**Step AH – deeper pass through Blaze.exe (negative results, method notes)**
- Method: `.text` (file 0x400, VA 0x401000, 1.3 MB) dumped with `objdump -D -b binary -mi386 -M intel --adjust-vma=0x401000`; address of a pattern hit in the slice = 0x401000 + slice offset (the earlier "0x5299ce"-style numbers
  I printed first were 0x400 too low). `.data` file offset -> VA = 0x400000 + 0x14f000 + (off - 0x14d600).
- The game code is recompiled PS1 code on PcEmu2 shims: file open goes through the name table at VA 0x566ba8 (`SYSTEM.INI;1`, `BLAZE.ALL;1`, `Blaze-Saving`) and PsyQ-style CD calls (sector << 11 before the read call, near 0x529b99).
  No u32 table of sector numbers exists anywhere in the exe (scanned all 1.5 MB for ascending runs in 4000..22600), so maps are not located by a static list; module sectors must come from BLAZE.ALL itself (or `cd.idx`, empty here).
- Looked for the script/text interpreter (control codes 0x1f 0xd0, 0x0c, 0x0f, 0x0b, 0x0a) by switch/compare patterns: nothing that matches; the only 0x1f jump-table switch (VA 0x5050f8) belongs to a menu state machine.
  Searching for `[reg+0x14]` / flag 0x82 compares only finds generic actor-struct code (hundreds of hits), no isolated door handler.
- Door link == arrival id test (arrival records from module headers + spawn entities with flag -255/-127 vs door entities with flag -126): 12 of 183 doors have a same-id arrival in some stage, which is at chance level for ids in 0..1400
  (so no evidence that `link` is a destination arrival id). Quest-chain door model from Step AG stays the working guess.
- To go further someone has to trace the executable at run time (breakpoint on the entity loader / door trigger in a debugger or an emulator of the x86 build) or reverse the actor structs by hand; static grepping is exhausted.

**Step AG – Blaze.exe look, arrival points, quest chains (door model v2)**
- `Blaze.exe` is a PC recompile of the PS1 game on a PlayStation-emulation layer (`playst.dll`, debug path `Playstation\PcEmu2`; exports `CdReadExec`, `LoadExec`, GTE helpers): game logic is native x86 using PS1-style APIs.
  It contains no map strings, no sentinel word 0x5F6F0000, no descriptor sector numbers and no cluster of door-link constants (searched as 32-bit values), i.e. maps are walked purely through the module pointer tables.
  Following the x86 logic needs real tracing/disassembly of a 1.3 MB .text (only `ndisasm`/`objdump` here, no symbols) – not done; the data side gave better results (below).
- ✅ **Arrival points**: the table part of each map module (first A bytes) contains 6-word records `type | y<<16 | x | z | rot | 0xffff0000|id | -1` = where the hero appears (stage 1: x -620, z 500 beside its door; inn: x 900, z -700).
  Exported as `arrivals` (39 of 78 stages have them); play mode now starts the hero there, facing the floor centre, instead of the "nearest floor to the door entity" guess. Arrival ids are not door link ids (checked: door links never occur as arrival
  ids in other maps; ids repeat between maps), so they do not give door destinations either.
- ✅ **Quests**: the Snd folder has Q00 (1) Q01 (10) Q02 (1) Q03 (10) Q04 (11) Q05 (10) Q06 (12) Q07 (3) Q08 (2) Q09 (2) Q10 (16) sound banks; the descriptor groups in BLAZE.ALL have the same sizes (Q01 = stages 6-15, Q02 = 16,
  Q03 = 17-26 …, Q10 = 65-77; groups with duplicate descriptors per area come out slightly smaller, e.g. Q10 13 maps for 16 banks). Stage JSON now has `quest`, `area`, `questRange`.
- Door model v2 (still a guess, labelled in the HUD): quest 0 = inn + rooms as before; elsewhere the door nearest to the arrival point is the entrance (-> previous area), other doors are exits (-> next area); the first area's entrance
  and the last area's exit lead to the inn (stage 0).

**Step AF – story-version picker**
- ✅ `export_stages.py` collects every descriptor whose first mesh pair is the stage's collision record and keeps the ones with different entities / dialogue as `variants` (entities, texts, name, desc sector) in stageNN.json.
  Counts: inn 10 extra, "Your Room" 38 (many near-identical), rooms 3-5 7-10, Hall of Demons 3-4, a few others. Stage 1's descriptor has one junk pair before its mesh pairs (parser now retries two words later), which also gives
  it a real texture list (atlases 3, 4, 6) instead of the guessed atlas.
- Play mode: a "story version N" dropdown (shown when the stage has variants) swaps entities and dialogue; door travel keeps the chosen index. Variant indices are NOT aligned across maps (identical copies were dropped per map),
  so version 3 of the inn is not necessarily the matching version 3 of a room.

**Step AE – script modules decoded as far as possible: they are data, not warp code**
- BLAZE.ALL holds **175 "map modules"** (`u32 256, A, B, 0 …` at a sector start; A = size of the table part, B = total): header + pointer tables, then the stage descriptor (sentinel), entity records, banner and text.
  The 12 modules before the maps are **global data**, not scripts: items (4057-4073: key items, flasks – strings like "Host's Door Key"), spells/bullets (4624), character-select UI (4633), memory-card UI (4638).
- **The Roadside Inn and its five rooms exist ~12 times** (descriptors 5549-5830 repeat in groups: inn 5549/5571/5591/5619/5642/5662…, rooms 5555/5577/5597…): story-state variants of the same maps (e.g. "Your Room" links
  [81,142] in most variants, [154] in two; room 4 gets an extra link 128 later). The stage list only contains the first variant of each. Same link ids in every variant => links are stable object ids, not per-copy.
- Link ids appear **only** in their own map's entity records (no destination table in the module, none in `Blaze.exe`: searched as 32-bit constants, no clusters; no `link` pairs between maps in a strict contiguous
  entity parse either). Door keys being data items suggests doors are gated/handled by state logic in the executable, not by a data table I can read statically. A door's real destination therefore stays unknown.
- Play mode guess refined: stages 1-5 (rooms) -> door returns to the inn (stage 0), the inn's door -> next room (cycles 1..5), other stages -> next stage in file order.
- Next candidates: expose the story-state variants (different dialogue per variant) in the picker; disassemble `Blaze.exe` around the entity loader (ndisasm is available) to see how `link`/flag are used.

**Step AD – the 17 "headerless stages" are not stages: 78 stages, real texture lists**
- ✅ A descriptor (`… texture pairs | sentinel | mesh pairs`) lists ALL records of a stage: first mesh pair = col16 collision record, then textured meshes, prop/monster packs. The 17 headerless textured records
  (old stages 17-19, 30, 31, 34, 36, 42-45, 48, 49, 66, 77, 79, 81, 82) all sit inside the mesh list of the PREVIOUS stage's descriptor and share its coordinate space: they are **extra meshes of that stage**.
  Stage 16 (lava cave): record 8172 is the flat lava surface at y = 800 (that was the "flat purple" stage 17), 8179 / 8195 more cave geometry. The exporter now merges them (`extraMeshes` in stageNN.json) -> **78 stages**
  (ids < 16 unchanged; later ids shifted down: old 20 -> 17 … – the stage picker / door guess use `STAGE_COUNT = 78`).
- ✅ Texture lists: the walk-back from the collision sector was limited to 12 words (descriptor lists can be 18 pairs long) and rejected sizes >= 60000 (66080 = 8-bit 256 x 256 mode-9 atlas, 2 VRAM pages wide).
  Now the descriptor is chosen by `first mesh pair == stage collision sector` and every texture pair < 100000 is kept. 66080-byte entries (mode 9, 8-bit 256 x 256, one per stage in 11 stages) are most likely sky /
  background pages: no face's page index reaches past the stage's 4-bit atlas count because of them, so they are not exported yet. Faces with page index == atlas count (stages 37-39, 41, 46: ~1-3 %) probably use a run-time page.
- Remaining without a list: stages 1, 25, 60 (their descriptors have another layout: no mesh pairs after the sentinel / the collision sector appears in the texture part).

**Door / exit targets – investigated, still unresolved (what is ruled out)**
- `link` ids do not pair up between stages (no second door with the same id in another room stage), are not stage numbers, descriptor sectors or descriptor indices (180 sentinels), and stage 6, the 'natural' hub, is a
  cave maze, not a town. Only room stages 0-5 have a clean entity table; for the other stages the 8-byte cell scan mostly finds noise (kinds like 10519 / 5376), so most "links" there are garbage.
- `Blaze.exe` never mentions descriptor sector numbers (searched as u16/u32: only code-immediate false positives), so the stage list is reached through data inside BLAZE.ALL. Around file offset 0x906000-0x912000 there are
  **8 script/data modules** (header `u32 256, A, B, 0, 4 …` at 0x906000, 0x906800, 0x907800, 0x908000 (A=1752, B=15404: the biggest, its offset table holds ~430 increasing offsets), 0x90c800, 0x90f000, 0x90f800,
  0x911000) next to the hero resource table. They look like the compiled game script (offset tables into bytecode); the warp targets (link id -> stage + entry point) are almost certainly executed by this VM.
  Decoding it is the next real step for doors; until then play mode keeps the "next stage in file order" guess (the stage picker lets you jump anywhere).

**Step AC – all-stage contact sheet: ground planes, collision fallback**
- Software-rendered all 96 stages (`render_stage.py`, scratch): 78 show recognisable maps (rooms, caves, mines, forests, castles).
- ✅ **Run-time palette 0**: faces whose palette row is 0 show random colours because palette 0 of every atlas is filled by the game at run time. This hits the big ground planes of the outdoor stages
  (20–26: one mesh with a single 128 x 128 tile repeated, texpage word 0 or pg 131). GUESS: they use atlas #2 of the stage's list with palette 3 (the grass/forest tile that other faces use); exporter marks
  these faces (`groundGuess` count per stage). The fields now look like forest/grass instead of rainbow noise. Real palette is unknown (maybe set per time of day/area by the script).
- ✅ 17 of the 18 "meshless" stages (17-19, 30, 34, 36, 42-45, 48, 49, 66, 77, 79, 81, 82) were a classification bug: their first record has `w[13] == 0` (the size field the textured records carry) but valid 32-byte textured
  rows, i.e. it is the stage's visible mesh **and** its walkable floor (no separate collision record). The exporter now returns such records as mesh + collision derived from the faces (96 stages as before, all but stage 75 have meshes).
  Their atlas lists are empty (texture-list walk-back finds no sentinel), so the default atlas is the old "page before the stage" guess and colours are wrong (flat purple/blue) – use the atlas dropdown; stage 75's
  record has another header (w12 = 2568). The viewer also draws collision triangles height-shaded for any stage still without a mesh.
- Door/exit `link` ids (98, 133, 109, 105 …) exceed the 96 stage count: probably ids in a larger map table (inside the executable); stage-script bytecode around the dialogue boxes shows `0a`/`07 03 xx` commands but no obvious warp opcode yet.

**Step AB – duplicate equipment sets on the heroes (two swords)**
- The hero meshes contain **two near-identical sets of equipment parts** at the end of the part list (hero 0: parts 17-21 and 22-26 with equal vertex counts). Rendered separately: set A = sword sheathed on the back,
  set B = drawn blade in the raised hand (+ scabbard). Drawing both gave the doubled sword/scabbard and the extra shield-like block. The viewer detects the pair (parts p and p+P with equal vertex counts over ≥ 3 parts,
  P = 3..8; found for 12 of 16 heroes, the other four have none or no clean match), hides one by default (**B = drawn weapon**, matches the raised-fist idle pose) and has a "gear A / B / A+B" dropdown for heroes.
  Which set the game shows when (probably A while walking, B in combat) is unknown.
- The dark "framed block" over the hero's right face half is most likely the hair lock covering that eye (it uses the hair tile), not a bug.

**Step AA – stage script texts + talking to the NPC; dungeon spawns cycle through the stage's monsters**
- ✅ `export_stages.py` now extracts the printable strings of the script stream after the `- Name -` banner (`texts` in stageNN.json): dialogue boxes `1f d0 id 0c "Speaker:\r text" 0f`, signs, menu strings
  (item name placeholder `0b xx xx xx` → `[item]`). Stage 1: the item expert's 21 lines, stage 2: stock box text, stage 10: gate/miners' sign texts (the stage 10 banner reads "5th Underlevel").
- Play mode: the attack button within 200 units of the NPC opens a text box and cycles all lines of the stage (script conditions are not decoded, so the order is just file order); tap the box to close.
- Entity survey of all stages: the big dungeons (20, 22, 24–27) have 75–290 spawn cells that are all `kind 0, sub 1`, stages 21 / 23 use kind 10 / 7 – so the monster type is not in the cell (probably chosen from the stage's
  monster list at run time). Play mode now fills the spawn cells with the stage's monsters in turn instead of ranking by kind. Many other "entities" in room-type stages are noise from the 8-byte cell scan (kinds like 5376 / 257).
- Open: real door targets (script commands), conditions that select a dialogue line, hero face quad (right eye region shows the shield tile – likely the swapped-eye UV animation).

**Step Z – the "(a,0,b,0)" rows: missing quads recovered (hero skipped faces 46 → 10)**
- Cause found: in those rows (the last row of most parts) the vertex bytes are the **first 4 bytes of the next part's subheader** (`a` = next part's vertex count, `b` = its normal count,
  e.g. part 0 → (13,0,15,0) = part 1 has 13 verts / 15 normals), i.e. the file overlaps the row's tail with the next record header; the real vertex indices are not stored there.
- Recovery (`meshparse.recover_bad_rows`, used by the hero, monster and prop exporters): the row's normal id is the part's last normal (a true face normal) and the UVs are intact, so the face is
  the set of vertices lying on one plane perpendicular to that normal (equal dot product), picked and ordered by fitting the 3-D points to the UV shape (similarity fit). Median fit error 0.01–0.1;
  ~70 % of bad rows recovered across the 16 heroes (rest are junk rows after real faces or have no plane match: fit error > 0.25 → left skipped). Heroes, monsters and stage props re-exported.
- Viewer message for hero 0 should now read ~10 skipped (6 junk rows of part 12 + 4 unrecovered).

**Step Y – hero "faces skipped": dummy-UV corners**
- The viewer's "N faces skipped" for hero 0 was 46: 27 were real faces recovered by one rule – **UV (2,123) marks an unused corner**, also when that corner's vertex index differs from the others
  (rows like `v=(29,30,27,28), uv3=(2,123)` are triangles (29,30,28); `v=(2,0,3,3)` with dummy in slot 2 is the triangle slots 0,1,3). Skipped faces for hero 0 are now 19.
- Remaining 19: **13 = the last face row of 13 parts** (`v = (a,0,b,0)`, e.g. part 0 `(13,0,15,0)`, part 1 `(12,0,9,0)`; real UVs and normal ids): its vertex bytes run into a trailing u16 table
  `a,b,b,b,a,b,b,0…` that sits between the face rows and the next record, so the true vertex indices are not in the row – maybe that table (open); 6 = junk rows after part 12's real faces.
- Next idea: test whether the u16 table gives the quad as (a,b,b,a…) / index pairs by matching UV shape to 3D edge ratios.

**Step X – level textures fixed (4-bit, 16 palettes per atlas), hero facing, prop collision sizes** (from the user's stage-10 screen recording)
- ✅ The noisy/missing colours were a decoding bug: atlases are **256 x 256, 4-bit, with 16 palettes** (not 128 x 256 8-bit). Each face picks its palette from `attr` bits 4-7 and
  its atlas from `pg & 31` (index into the stage's atlas list). The exporter now writes `aNNN.png` (colour indices) + `aNNN.pal.png` (16 x 16 palette) and the viewer builds one
  coloured page per stage (a slot per used atlas/palette pair). The atlas dropdown has "auto (per face)" or forces one atlas for all faces. (271 atlases; one 8-bit record dropped.)
- ✅ Software render of stage 10 now shows the real mine layout (tracks, two caverns, long corridor). Some floor faces still use "debug" number tiles (pg 1, palette 13) – probably
  textures the game overwrites at run time.
- ✅ Hero facing: models face −z at yaw 0 (rendered from four sides), the play-mode yaw is now `heading + PI` (it was walking backwards); same for monsters.
- ✅ Collision: floor heights from the collision mesh match the visible floor (checked on stage 10); prop collision circles are now sized from each prop mesh (0.7 x radius, max 90, flat decals skipped)
  instead of a fixed 55; the hero no longer spawns inside entity 0 when that is a prop (stage 10: pedestal/crystal).
- Open: purpose of the numbered tiles, semi-transparent faces (cmd bit 1) are drawn opaque, palette choice for props (borrowed from the stage's most common atlas-0 palette), stage-10 mesh 6854 / 6882 /
  6894 may be alternative or event versions drawn on top of each other.

**Step W – monster animation slots (guess), actor/prop collision, door travel (guess)**
- Monster anim packs have 1–15 anims (mostly 4–7); slot 2 is 20 frames in 68 of 97 monsters (shared "hit" template) and slot 3 is mostly 15 frames, so monsters follow the hero
  layout: **0 idle, 1 walk, 2 hit, 3 attack, last slot = die** (unconfirmed – eyeball in the viewer's anim buttons and tell me what is wrong).
  Play mode uses them: walk while chasing, attack swing on contact, hit flinch when struck, die plays once then the body shrinks.
- Collision: prop records (flag −254, radius 55) block hero and enemies, the NPC blocks enemies, enemies push each other apart.
- Doors: the first record (flag −126, kind −1) is a door; walking up to it in play mode loads the **next stage in file order (guess)**, keeping HP. `link` is NOT a stage number
  (98, 133, 57, 81 …): it indexes the stage's script bytecode, which starts after the `- Name -` banner – first findings in docs/FORMATS.md (dialogue boxes `1f d0 id 0c text 0f`).
- Next: decode the script commands (give item, flags, warp) to get real door targets; monster ↔ spawn kind mapping.

**Step V – stage monster lists, better default atlas, enemies + NPC + combat in play mode (UNTESTED, heuristic)**
- ✅ A stage's **texture list holds the monster/NPC textures it streams in**; matching them against the model table gives `monsters: [ids]` per stage
  (stage 20: models 0, 16, 14; stage 23: 15, 39, 40; stage 1 "The Room": **model 84 = the item expert NPC**; stage 6: model 3). The walk-back over texture pairs now accepts any size
  1000–60000 (monster textures are 5–17 KB). 
- Default atlas = the listed atlas with the most distinct colours (blank/flat pages such as 6812 or 6140 are skipped) – the Abandoned Mine no longer starts on a white page.
- Play mode: NPC placed on the room's linked prop entity; dungeons spawn up to 10 enemies from the entity cells: cells grouped by `kind` (sub 1), most common kind → first listed
  monster, next kind → second … (**guess**: the kind↔model mapping is unknown). Enemies chase within 700 units, hit for 8 per 1.2 s when within 90 (hero plays hurt), hero attacks
  (⚔ / Space) deal 34 damage within 170 units; enemies shrink away when dead; HP/enemy counter at bottom-left; hero dies at 0 HP (anim 7, frozen).
- A stage picker next to "▶ Play stage" chooses the stage to play (default 1); pick e.g. stage 10 (Abandoned Mine) or 20 to meet enemies.
- Not done: monster attack/hit/die animations (monster slots unknown), collision between actors/props, loot, XP, doors/stage links.

**Step U – entity cells for all stages + markers in the viewer**
- ✅ Entity tables are streams of **32-byte records made of 16-byte cells**; the exporter now scans the stream between the mesh pairs and the stage banner in 8-byte steps
  for the cell `(kind, sub, flag, 0, x, y, z, 0)` with flag −260…−20, giving 11 cells in stage 1 (room), 146 in stage 20, 115 in stage 23, 89 in stage 21 (dungeons).
  rot/link come from the next cell of the record. Dungeon records use flags −255/−127/−126/−30; the dominant `kind` per stage (stage 20: 0 ×123, stage 21: 10 ×70,
  stage 23: 7 ×88) at y = 150/250 looks like the main enemy/spawn type, but it does not equal the model ids in the stage texture list, and no monster-name/stat table exists in the
  file by name (searched "Goblin/Skeleton/Slime/Jackal": only dialogue text), so the id → monster mapping is open.
- Viewer: non-prop entity cells are drawn as small coloured boxes (colour = kind mod 8) – use them to check whether the positions lie on the floor/collision of each stage.

**Step T – the last byte of a room face row is the PS1 GPU command (exact triangle/quad flag)**
- ✅ Face rows' final byte = GPU packet command: 0x24–0x27 / 0x34–0x37 = triangle, 0x2c–0x2f / 0x3c–0x3f = quad. The padded 4th vertex (index 0) of triangles matches this in
  ~98% of rows; the exporter now uses the command byte instead of the distance heuristic (Step N) and stores `cmd` and `pg` per face.
  The low 16 bits of that u32 look like a PS1 **texpage word** (bit 4 page Y, bits 5–6 transparency, bit 7 8-bit depth); X bits are always 0, so the u≥128 texels
  must lie in the neighbouring atlas of the same 256-wide page.
- ❓ Cave stages: splitting faces by the page-Y bit and pairing atlases as [A|B] / [C|D] still shows noise/white (atlas D, e.g. sector 6140, is mostly blank), so the
  atlas assignment is not verified. Rooms (stages 1–5) still render correctly.
- Dungeon entity records use another layout (`…, kind, sub, flag | 0, x, y, z …` with the flag at word 4, e.g. `(0,0,7,1,-127,0, 4704,150,-5876,…)`): the room-table parser
  only reads their first records. A real dungeon-spawn parser is still to do.

**Step S – dungeon stage entities: what is known**
- Dungeon stages (e.g. 20, 21, 23) also use 32-byte entity records, but with flags −255 / −127 / −126 / −30 and much bigger tables
  (stage 20: 63 records, 57 × `kind 0, sub 1` at y = 150; stage 21: 70 × `kind 10`; stage 23: 65 × `kind 7`, plus `kind 5633…5635 sub 8` and
  `kind 256 sub 6, link 741/814`). Positions lie in the collision box, so these are placements (spawns, chests, triggers), first record = entrance.
- The stage's texture list (before the sentinel) contains the **monster textures it needs**: stage 20 → models 0, 16, 14 (jackal warrior, …),
  stage 23 → models 15, 39, 40. The numeric `kind` of the repeating records does **not** equal one of those model ids (stage 23 uses 7), so `kind`
  is probably an index into a per-stage spawn/loot table that sits in the script data – not decoded yet.
- Next lead: dump the script data between the entity table and the banner for a dungeon stage and look for lists with 7/10/0 as indices.

**Step R – entity table decoded for room stages; props placed**
- ✅ After a stage's mesh-pair list come **32-byte entity records** (kind, sub, flag | x, y, z | rot, link …). x/z lie inside the room box; y is
  height (floor 400 or 100). Ordinary records (flag −254) are **props**: `kind` = part index in the stage's props pack (bed, counter, wardrobe,
  cupboard, table …); the first two records are the entrance door/trigger (`link` = destination). Checked by rendering stage 1 with props at
  their positions: tables/beds sit sensibly against the walls (rotation sign not distinguishable from the picture; both looked plausible).
- 38 of 96 stages have such a table (rooms, inns, town buildings; some dungeon stages produced big tables such as stage 20: 63, 23: 89 records –
  probably monster/chest spawns with a different `kind` meaning). 20 distinct props packs exported as `props<sector>.json`.
- Viewer/play: `StageView.addProps()` places the props; play mode spawns the hero at the door position (nudged inward until it is on the
  floor). Props have no collision yet.
- Not decoded: meaning of `sub`, `link` (stage ids? 98/133/52…), how doors map to stage indices, spawn tables in dungeons, NPC records (e.g. kind 2 / link 57 = the expert?).

**Step Q – stage names and the shape of the stage script**
- ✅ Each stage descriptor is followed (within ~0x900 bytes) by a Pascal-style name string `- The Room -`; found for **30 of 96 stages**
  (0 The Roadside Inn, 1 The Room [item expert NPC], 2 Your Room, 10/11 The Abandoned Mine, 15 The Ruins Within the Earth,
  29–31/36 Underground Cave, 63 The Palace of the Immortal, 64 The Fantastic Palace, 73/75 The Ancient Ruins, 74 The Sorcerer's
  Laboratory, 78/79 The Griffon's Nest, 84/92 The Sealed Cave, 89 Ice Grotto, 93 The Land of Storms, 94/95 The Hall of Demons).
  Dungeon floors without a banner name stay unnamed. The stage dropdown shows the names; `index.json` has `name`.
- ✅ Stage 1 ("The Room") script contains the **item expert's dialogue** ("The expert: Ho, it's a bunch of newbies!", appraisal lines such as
  "Hee hee… that's a <item> if I ever saw one") – so NPC dialogue is embedded as text with `\r` line breaks and item-name substitution slots.
  The same stage layouts are repeated 12× in the file (once per save/variant block), 0xa800–0xb000 apart.
- Not decoded: the entity table before the name (16-bit position/orientation records with y=400) and the script opcodes between texts.

**Step P – hero animation roles confirmed by eye (user check on the phone) + actions in play mode**
- ✅ Confirmed by the user watching the viewer: hero **anim 0 = idle**; **anim 2 = hurt/flinch** (was guessed "run"); **anim 3 = attack**
  (was "hit"); **anim 4 = jump** (was "attack"); **anim 6 = a second attack**; **anim 7 = dying**; **anim 8 = victory / level-up**
  (the 1-frame extra blob I assumed to be a pose is the victory pose – only some heroes have anim 8). Not commented on: anim 1
  (assumed walk, still marked "walk?") and anim 5 (frame counts 6–29, role unknown – maybe cast/skill).
  Monster labels are still guesses ("?"), since heroes and monsters do not share the same slot order.
- Play mode: Space/J attack, K attack 2, L jump (with a hop), H hurt, V victory, plus touch buttons ⚔ ⚔2 ⤒ ★; one-shot actions
  block movement until the animation has played once.
- Peek at stage script data (not decoded): after the mesh list of a stage descriptor come 24-byte-ish records of i16 values such as
  `(−254, 0, −692, 400 …)` (y = 400 = floor height → probably entity/NPC/door placements) and then **dialogue strings** ("he …", ASCII). Positions
  do not fall inside the stage-1 room box (x −1540…−550), so the table is either relative, or shared by several room variants.

**Step O – first playable slice: walk a hero around a stage (UNTESTED in a browser)**
- `src/play.ts` (`PlayMode`) + a "▶ Play stage" button in the viewer HUD: loads the selected stage (stage 1 if a hero/monster is selected)
  in raw PS1 units (`loadStage(k, false)`), the selected hero (hero 0 by default), and walks the hero on the stage's **collision mesh**.
  PS1 (x,y,z) → world (x,−y,−z); up-facing collision triangles (|ny|≥0.5) are the floor (stage 1: 78 of 143; heights 400, 432, 436 …
  = floor, steps, furniture tops); a move is accepted if the target is inside a floor triangle within 80 units of the current height
  (axis-sliding fallback). Controls: WASD/arrows + Q/E (turn camera) or touch: left half = stick, right half drag = turn camera.
  Animation guess: hero anim 1 while moving, else 0 (labels still unverified).
- Open risks to check on the phone: hero scale vs room (hero ≈ 110 units tall, stage 1 walls ≈ 200), hero feet offset, camera clipping,
  atlas choice for the stage, collision at doors; no enemies, props, doors or stage links yet.

**Step N – busy stages (caves) fixed: triangle rows are padded with vertex 0**
- 🐞 Stages 6+ rendered as spiky fans because triangles in room meshes are stored as `(a,b,c,0)` – the 4th index is vertex **0**, not a repeat of
  an earlier index. The exporter now turns those rows into repeated-index rows (unless vertex 0 is geometrically near the others) → the cave
  stages (e.g. stage 7: 1044/829 verts/faces floor + wall meshes) now show clean cave outlines. Stage JSON also carries `pg` per face
  (page bit = bits 16–23 of the attr word) for the atlas question.
- ❓ Atlas assignment on cave stages is still **unresolved**: u goes up to 255 on a 128-wide atlas and `pg` is 0/1, but every combination
  of a left/right atlas pair from the stage list looks like dithered noise (cave rock is genuinely dithered) or white (atlas 6140 is a
  mostly blank page – maybe dynamic/lightmap), so the visual check is inconclusive. Needs a clearer test (e.g. a stage with a recognisable
  painted texture, or reading how the face's attr low byte maps to a tile offset).
- Collision meshes are exported in `stageNN.json → collision` (verts + u16 triangles) for later walkability work.

**Step M – stage resource descriptors parsed (atlas lists per stage)**
- ✅ Each stage has a descriptor of `(sector,size)` u32 pairs: **texture pairs** (33312 B = 128×256 atlas, 16928 B = 256×64 texture,
  12832 …) | sentinel `1601110016, x` | **mesh pairs** (collision, walls, floors, …, props pack, text pack) | `0xffffffff, 65410`.
  Example (stage 1 / sector 5155): textures 4987, 5004, 918, 5138; meshes 5155, 5158, 5162, props 5165, text 5079. Located by finding the
  collision sector as a u32 and walking back to the sentinel (62 of 96 stages found this way; others have no copy near a sentinel).
  Stage texture lists also contain monster textures (e.g. 303), so monsters are streamed per stage.
- Observed on busy stages (6–8): face UVs use u up to 255 and attribute byte (bits 16–23 of the u32 at +28) is 0/1, so faces probably
  address a **256-wide page = two 128-wide atlases side by side** and/or pick between atlas pairs; with a single atlas those stages
  render as noise. Atlases 5840 / 5857 look noisy even alone (maybe a second CLUT/other depth) – undecoded.
- Viewer: stage atlas dropdown marks the listed atlases with ★ and starts on the first one.
- Next: decode the page rule (render stage 6 with [A|B] pages and attr bit), parse collision tris into walkable data, place props.

**Step L – ROOM GEOMETRY decoded: 96 stages (walls/floors) in the viewer**
- ✅ Blobs 5155 / 5158 / 5162 are **room meshes**: header words `V|N<<16`, `F`, vertex table @0x40 (`i16 x,y,z,pad`), normals, then faces.
  5158 = walls, 5162 = floor (32-byte face rows with UVs into a **128×256 atlas**), 5155 = collision (16-byte rows, no UV).
  Rendered correctly with atlas 4987 (green wallpaper room) and 5004 (stone variant); 5138 is a plain colour page. Formats: docs/FORMATS.md.
- ✅ A whole-file signature scan finds **562 room-mesh records = 96 stages** (collision record + 1–8 textured records each) and
  272 atlases. `tools/export_stages.py` → `public/assets/stages/stageNN.json` (16 MB), `aNNN.png`, `index.json`.
- Viewer: entries 113–208 = stages (rotating, auto-scaled), with an "atlas" dropdown (the stage→atlas pairing is a guess:
  stages 0–5 default to atlas 4 = sector 4987, others to a nearby-preceding one; pick another if textures look wrong).
- 🐞 Fixed: the previous commit's monster dropdown still had only 78 entries (an edit had not applied); it now lists all 97.
- Not verified: stage names/numbering, which atlas each stage uses, object placement (props pack 5165 etc. → positions), spawn points,
  door/exit links, what the u32/u16 tables at `w12`/`w13` are (collision grid? visibility lists?).

**Step K – level data survey: texture atlases and prop meshes found (levels live in sectors 5072–22473)**
- 272 packs (sectors 4026–22473) are still unclassified; 5231 (16 × 640 B, e.g. a "Genocide" record) is another item table.
- ✅ Level resources are listed as **(sector,size) pairs inside stage/script data** (e.g. around file offset 0xad9cf0: 4987, 5004, 918, 5138,
  5155, 5158, 5162, 5165, 5079). The size matches the resource size, so each pair is a resource reference of one stage.
- ✅ **Tile/wall texture atlases**: 4987, 5004, 5138 = 128×256, 1 CLUT, same record layout as monster textures (`docs/level_textures.png`);
  918 = 192×64 (portrait/UI-like). 5138 uses a cyan colour-0.
- ✅ **Prop meshes**: packs 5072 / 5165 / 5225 start with identical offsets (19–25 blobs) = a shared **object set** (beds, tables, bookshelves,
  chandelier, cupboards …) that `meshparse.parse_pack` reads as-is (16 of 25 blobs → parts; others are probably grids/colliders – blob 0
  looks like a 111-cell u32 grid `00 00 00 20 …`). Rendered with atlas 4987 in `docs/level_props_5072.png` (some UV stretching remains,
  perhaps the atlas is 128 wide, not 256). `tools/render_static.py` renders any such pack.
- Pack 5079 (4 blobs, size 2580) is a text pack (UTF-16-ish strings), 5155/5158/5162 are non-pack blobs (6016/6316/5360 B; map/tile data?).
- Not verified: where the map layout (floor grid, wall placement, object positions) is stored, how stages are numbered, collision data.

**Step J – animation roles guessed from frame counts; README link; engine exe spotted**
- README now links the live viewer (https://beefbeefs.github.io/remake2/). The repo's "About" website field could not be set from
  here (the proxy blocks repository-settings writes) – set it by hand: repo page → ⚙ next to About → Website.
- Frame counts per animation are very regular across models. Heroes: blob 1 always **10** frames, blob 2 always **7**, blob 3 **5–6**
  (4 for two heroes: 20), the last blob 19–24 and, for some heroes, one extra 1-frame blob; monsters: blob 2 is **20 frames in ~all models**,
  blob 3 mostly 15. Working labels (UNVERIFIED, shown with "?" in the viewer): heroes 0 idle, 1 walk, 2 run, 3 hit, 4 attack;
  monsters 0 idle, 1 walk, 2 attack, 3 hit. Others stay "anim n".
- `hero_small_2592` blobs are **not** animation data: they are 4-bit portrait images (header `16, 8, 0x20c …` + CLUT + packed nibbles).
- The PC engine `Blaze.exe` (1.5 MB, in the original install next to BLAZE.ALL, not yet in the repo) is the real source for animation
  indices, stats and the monster table consumer: `objdump -D -M intel` is available; looking for the code that reads
  0x9119f0-table entries / animation indices is the next lead. `English/data/action.txt` is just the control-action names.

**Step I – REAL model table found: every model has exactly one texture (monster texture mapping solved)**
- ✅ `original/BLAZE.ALL` is now committed (46 MB; repo to be made private).
- ✅ Found by searching for the monster anim sectors as a stride-2 u32 sequence: a **model table at file offset 0x9119f0** of
  `(sector,size)` pairs = three parallel lists of **113 models**: textures, animation packs, mesh packs (`data/model_table.json`).
  Entries 0–15 are the heroes (same as the older table), entries **16–112 are 97 monsters** (monster *k* = entry 16+k).
  Monster 0: texture 280, anim 1297, mesh 2764 – the earlier greedy pairing was right where it succeeded but missed 19 monsters.
  A second, shorter copy of the lists follows (31 textures 759.., 80 anims 1030.. – not analysed).
- ✅ The "stacked strip groups" idea of Step H was wrong: each monster has **its own** 256×≤64 texture (1 CLUT) – monsters 0–3 now
  render coherently with their own record only (spiked-hair mage, purple goblin-knights, grey bat/gargoyle…).
  The few faces with UV v ≥ 64 (≈2% of faces) are still skipped, so something (weapon/effect page?) is unresolved.
- ✅ Four packs are single-blob (n=1) and were missing from `data/packs.json` (meshes 2874, 2892, 2933; anim 2632) – the exporter
  now reads their header directly. `tools/export_monsters.py` → 97 × `public/assets/monsters/monNN.json` + `monNN.png` (7.4 MB).
- Viewer: entries 16–112 = monsters; "tex group" selector removed. Superseded: `data/monster_pairs.json`.
- Still unknown: monster names/stats/AI, which animation is idle/walk/attack, meaning of v ≥ 64 UVs, the second table copy.

**Step H – monsters pair up and render; viewer now lists 78 monsters**
- ✅ Pack 4026 / 4056 are spell/effect meshes, not characters. Monster **anim packs** (sectors 1297–2400, 81 packs) and **mesh packs**
  (2764–3365, 94 packs) pair up by "anim part count C == mesh pack n", greedy in sector order: 78 of 81 pair
  (`data/monster_pairs.json`); 16 mesh packs (3241–3362) are left over (NPCs / bosses / props?).
- ✅ The tables that contain sector numbers like 1297 at 16-byte stride (file offset 0x2dd1b0) are **not** model tables
  (they look like script/event records) – other copies of the hero resource table are just variants of the one already known.
- ✅ Monster textures (sectors 280–1030, 97 records) are **psize 524 = 1 CLUT**, 256-px wide strips. The real strip size is
  in the pixel header: `u16 A,B @ +8` = VRAM width in halfwords (2A px) × height B (hero tex was 128/64 → 256×64).
  Strips are 64 rows high; **a strip shorter than 64 closes a group** → 31 groups (stacked vertically; mesh UVs reach v≈208).
- ✅ Group *k* ↔ monster *k* gives clearly right results for monsters 0 (jackal-headed warrior) and 2; monsters 1 and 3 show wrong-looking
  areas (green/red concentric patterns) so that mapping is **a guess only**, and 78 monsters share 31 groups, i.e. recolours/variants
  (monsters ≥ 31 default to group 0 – use the new "tex group" selector in the viewer to try others).
- (Step H's group/texture hypothesis and exports were superseded by Step I.)
- Not verified: true monster↔texture table (not found yet), monster names, which anim is idle/walk/attack, the 16 spare mesh packs.

### Turn 7 (continues from Turn 6; notes after each step)
**Step A – model→texture link FOUND**
- ✅ BLAZE.ALL contains a **resource table** (copies at file offsets 0x906b88, 0x907388, …; `data/resource_table.json`) of
  `(sector, size)` u32 pairs. After 5 misc textures it lists, in parallel order: **16 hero textures** (sectors 120,130,…,270,
  18464 B each), 16 small blobs (3437…, 2592 B), 8 blobs (3469…, 6400 B), **16 animation packs** (3501, 1030, 1046, …, 1271)
  and **16 mesh packs** (3521, 2634, 2641, …, 2753). Entry *k* of each list belongs to hero *k*.
  → knight (anim 3501 / mesh 3521) uses **texture 120** (256×64, 4 CLUTs of 256 colours: psize 2060 = 12 + 4·512).
- ✅ Verified visually: the knight's UV rectangles (v<64) line up with the eye, helmet, chest, arms and legs pieces in tex 120
  (`/tmp` overlay; recreate with tools/ once added).
- 💡 The 48 faces with v ≥ 64 are the ones that produce long fan-shaped UV lines from one corner → the "R1" rows are
  **not valid textured quads**. This explains their out-of-range vertex indices: they are probably a different structure.
- Not verified: which of the 4 CLUTs (red/green/grey-blue/gold colour schemes) is the default; meaning of the 16×2592 and 8×6400 blobs (maybe equipment/palettes);
  other 15 heroes not yet checked.


### Turn 8 (continues; notes after each step)
**Step G – starting-kit item records decoded (text only)**
- ✅ The 8 × 6400 B resource entries are **starting kits**: 10 records of 640 B each, `name[64] | u8 len + "Name/Description\r(Effect)" @+64 |
  binary fields`. Kits: Normal Sword + Leather Armor + Leather Shield + Healing Potion; Club + Robe + Healing Potion; Dagger +
  Leather Armor; Wooden Wand + Robe; Shortbow + Leather Armor; Shortsword + Leather Armor; Tomahawk + Leather Armor + Leather Shield; Rod + Robe
  (each with a Healing Potion). `tools/extract_items.py` → `data/start_kits.json` (26 items; raw bytes at +16..19 and +48..55 kept).
- Hypotheses, not verified: +48 = weapon attack (sword 7), +50/+54 = armour defence values (5, 3); 8 kits ↔ 16 heroes is probably 8 classes × 2 genders.
- Not verified: the binary fields, how a hero maps to a kit, the other ~250 bytes of each record (effect scripts?).

**Step F – "v ≥ 64" faces were valid triangles with a dummy UV slot (viewer fixed)**
- ✅ 10 % of faces (722 of 7,303 main rows) had UVs outside the 64-row page and *none* of them was rectangle-like, whereas 33 % of the others
  are. Cause: **triangles are stored as quad rows with a repeated vertex index, and the repeated slot carries the dummy UV (2,123)**
  (e.g. vertex idx `(9,8,8,10)`, uv slot 2 = `(2,123)`). My old triangulation used the dummy slot's UV. Correct rule: take the first slot
  of every distinct vertex index (`(a,b,b,c)` → slots 0,1,3). The earlier "fan from one corner" UV lines were this dummy.
- ✅ Applied in `src/model/modelViewer.ts` and in my software renderer; wizard/warrior/elf/knight textures are cleaner
  (`docs/heroes_sample.png`, hero 0/3/8/15).
- ✅ The 16 × 2592 B resource entries are 256×8 icon strips (8 tiles of 32×8), *not* a second model texture page; the 8 × 6400 B entries start with the ASCII
  text "Normal Sword" (weapon records – not parsed yet).
- Not verified: browser run of the viewer; rows with three distinct indices but 4-slot order assumptions (winding/orientation of triangles
  is unchecked, the viewer uses DoubleSide).

**Step E – face data layout SOLVED (mostly): the "R1" rows belong to the previous part**
- ✅ Evidence chain: (1) 66 % of out-of-range faces fit entirely inside the *previous* part's vertex count and 65 % of their
  true quads are planar there (control: own valid faces 56 %; part two back: 8 hits); (2) re-assigning rows as
  F2(P) + R1(P+1) cut out-of-range faces from 13.7 % to 3.1 %; (3) rows between a part's F2 start and the next subheader
  equal **F = low half of subheader word 0** in 257/351 parts (N, the normal count, may be larger: e.g. hero 0 part 0 F=14, N=18) and
  66 of the other 94 match F too.
- ✅ Layout (docs/FORMATS.md, `meshparse.parse_pack`): record i starts at `base+offs[i]+h0` (h0 = subheader offset inside the
  slice: 112 / 84 / 132); `subheader | V verts @+w7-4 | N normals @+w8-4 | F face rows @+w9`, rows continue across the slice
  boundary up to the next record's subheader. The pack's offset table points *h0 bytes before* each record, so each slice
  starts with the tail of the previous part's face list.
- ✅ Slices with no subheader (e.g. hero 3 parts 11-14, 19-24; hero 0 parts 13-16) are extra face rows ("joint caps")
  that index the preceding part's vertices (part 19 max index 46 = part 18's V−1; part 11 max 21 = part 10's V−1); 61 % of them are fully
  in range – kept only when in range, drawn in the preceding part's space (bone assumption unverified).
- Result over all 16 heroes: **7,508 faces, 2.9 % with out-of-range vertex indices** (was ≈21 %), 22/27 → more parts per hero;
  `docs/heroes_sample.png` shows heroes 0, 3, 8, 15 now with shoulders, boots, shields, hair.
- Not verified: where the extra rows belong (own bone vs previous part's bone), why 94 parts still differ from F, 10 % of faces
  have UV v ≥ 64 (second texture page? skipped by the viewer), animation meaning.

**Step D – all 16 heroes + all animations (software-verified, browser run pending)**
- ✅ **Blob alignment fix**: face rows (16 B) straddle the pack's blob boundaries for most heroes. The subheader sits at
  `h = 112` (heroes 0, 2), `84` (hero 1) or `132` (hero 3, 15) – not 16-aligned in the latter cases. Shifting the window back by
  `(-h) % 16` realigns it (`meshparse.parse_part_at`; subheader found at any 4-byte phase, validated by `w1 = V | N<<16`).
  Hero 0's earlier "R1" rows were fine geometrically; the garbage was mostly my own window, though ~20 % of faces still
  reference vertices ≥ V in every hero (open).
- ✅ Table check: each hero's animation blob has C = number of mesh-pack parts (27/27, 20/20, 32/32 …) for all 16.
- ✅ Each hero has 8–9 animation blobs (frame counts such as 14/10/7/5/15/…, last one 1 frame = pose). Geometry is exported once per hero with
  an `anims` list (`tools/export_heroes.py` → `public/assets/heroes/hero00..15.json`, 1.4 MB total). Old `export_model.py` /
  `export_parts.py` / `pack_3521.json` removed.
- ✅ Viewer: hero (0–15), animation and palette dropdowns (`src/main.ts`, `src/model/modelViewer.ts`).
- ✅ `docs/heroes_sample.png`: textured software renders of heroes 0, 1, 3, 8 (frame 0, front): faces, hair, robes, staff/spear land
  on the right places, so the table + texture link + realignment hold for other heroes.
- Not verified: browser run; parts that still fail to parse (e.g. hero 3: 17/32, hero 15: 19/32 – their subheader doesn't match
  the strict check, so those limbs/props are missing); animation meanings (which blob is idle/walk/attack – guesses only);
  non-hero models (monsters, NPCs, items) not exported yet.

**Step C – textured knight (software-verified, browser run pending)**
- ✅ `tools/export_hero_tex.py` → `public/assets/hero/h<k>_c<j>.png` (16 heroes × 4 CLUTs; the 4 CLUTs are colour schemes:
  red, green, grey-blue, gold). PS1 colour 0 = transparent.
- ✅ Viewer now textures every part (UV = (u+.5)/256, (v+.5)/64, nearest filter, alphaTest) with a palette dropdown in the HUD
  (`src/model/modelViewer.ts` `setTexture`, `src/main.ts`).
- ✅ Verified with a Python software rasteriser (`docs/knight_textured.png`, frame 0, seen from behind because of my
  test renderer's depth sign): hair, red tunic, skin, belt, gold/grey armour all land on the right parts → UV mapping and
  triangle split are right. Face/front pieces are absent: they are among the skipped R1 faces.
- Not verified: in the real viewer (needs your phone/browser after the Pages deploy); other 15 heroes' meshes not exported yet.

**Step B – mesh layout corrected, R1 rows still open**
- ✅ Corrected again (verified by data, not guesses): **V = (w8-w7)/8 vertices at `h+w7-4`** (= low u16 of subheader word 1; slot
  before vertex 0 is a zero vertex) and **normals at `h+w8-4`** (4 B gap before F2). Normals now come out unit length (≈4096) – earlier
  `-12` reads were off by 8 bytes. My Turn 6 "V−1" was wrong; F2 faces were fine either way.
- Out-of-range faces: 83 → 61 of 377 on the knight.
- ❓ R1 (the 7 rows before the subheader): UV rects are valid for several rows but vertex indices are not (mostly row 6, and
  all 7 rows in parts with few vertices). Tested index shift −1/0/+1 and "nearest other part's vertex": no planar quads → unresolved.
  Rows with v≥64 UVs and fan-shaped UVs look like mis-parsed data. Currently skipped.

## Turn 6 – 2026-11-24 (multi-step; notes after each step)
**Verified in browser (user, via GitHub Pages)**: viewer runs, knight assembles from skeleton and animates. Camera was too close; framing adjusted.

**Pages deploy** – `.github/workflows/pages.yml` builds with Vite and deploys `dist/` on every push to main.
One-time manual step: repo Settings → Pages → Source = "GitHub Actions". Not verified (can't reach the Pages API from here).

**Step 4 – three.js model viewer (written, NOT run)**
- ✅ `src/model/modelViewer.ts` (`AnimatedModel`, `loadModel`): builds the bone tree from `parent[]`, attaches flat-shaded
  part meshes to their bones, plays the 14 frames at 8 fps (Euler order `XYZ`, root rotated π about X because PS1 is Y-down).
  `src/main.ts` now shows the spinning knight instead of the placeholder box (HUD status line reports skipped faces).
- ⚠️ Not verified: `npm install` is blocked here, so it was never built/run in a browser. Typecheck with a stubbed `three`
  module shows no errors other than stub artefacts. Frames were sanity-checked in Python only (`docs/knight_frames.png`,
  subtle arm/sword motion, looks like an idle loop). Please run `npm install && npm run dev` and tell me what you see.
- Also fixed: last part of a pack read face rows to the end of the pack (63k faces); face count is now capped at #normals,
  and the last blob ends at the next pack. Part 26 (bone 58) is now 33 faces.

**Step 3 – face→texture mapping (NOT solved)**
- Face rows: `id[4]` are all equal within a row and count up per part (0,1,… / 2,3,… ) – they look like a per-part face
  counter/sort key, **not** a texture or CLUT index. UVs are 0–255 / 0–123 (one 256-wide page, up to 128 high).
- Tried to find the knight's texture by scoring all 503 extracted textures (opaque coverage, then UV-rect edge alignment vs
  shifted rects). Results are not trustworthy: the winner (sector 7909) is a minimap sheet. Character textures
  live at sectors 120–640 (256×64 sheets with faces/eyes, hero skins at 120–270), but a 64-px sheet doesn't cover v up to 123.
- Hypothesis: the model→texture link is in a table I haven't parsed (e.g. an actor/model definition in a pack or level
  block, possibly with the CLUT/tpage word). Next: look for records that reference sectors 3501/3521 and a texture sector.
- Still open from Step 1: first 7 face rows of every part reference vertices that don't exist in the part (they are valid
  quads by UV). The "nearest vertex" test against all assembled parts found no exact match, so a neighbour-part
  reference is unproven. These faces are currently skipped (83 of 377 knight faces ≈ 22%, per the in-browser status line).

**Step 2 – assemble model from bones + pose 0 (done for the knight, pack 3521 + anim 3501)**
- ✅ `tools/assemble.py`: bone world transforms from parent table + frame-0 pose. **Rotation matrix order X·Y·Z** (angles
  4096 = 360°) gives a coherent knight with a sword (zyx/xzy give garbage). See `docs/knight_pose0.png` (front + side wireframe).
- ✅ `tools/export_model.py` → `public/assets/models/pack_3521.json` now holds parts (with bone index), bone parents,
  114 poses and 14 frame index lists, ready for a three.js skeleton viewer (Step 4).
- ⚠️ Not verified: only frame 0 checked; 5 of 27 parts did not parse (22/27); handedness/Y-up; R1 face rows still
  excluded from sensible output (see Step 1), so some seams/holes are expected; animation 3501 blob 0 is presumably "idle"
  (other blobs/frames unchecked).

**Step 1 – vertex indexing (partly solved)**
- ✅ Corrected vertex base: vertices at `h+w7-4`, count `(w8-w7)/8-1` (previous `-12`/no `-1` was off by 8 bytes; F2 quads
  are now exactly planar rectangles, e.g. pack 3521 part 2).
- ✅ The 2nd face list (F2) indexes the part's own vertices correctly. The first 7 rows ("R1") do **not** – they use
  out-of-range indices; R1 is probably seam/joint geometry referencing neighbouring parts' vertices (unresolved).
- ✅ **Hierarchy table decoded**: `[-1,-1] + 59 bone parents + 27 part→bone indices` (2+59+27 = 88 = A+2).

**Next**: animation names (which blob is idle/walk/attack), item stat fields, monster/NPC models, level data.

## Turn 5 – 2026-11-24
**Done**
- ✅ **Mesh format found**: face rows (quad + UVs + vertex idx), vertices, normals (`tools/meshparse.py`). #faces == #normals
  in every blob; plotted parts look right (one is a sword). 395 parts parsed across 23 mesh packs (sectors 2764–3521).
  Sample export: `public/assets/models/pack_3521.json` (`tools/export_parts.py`).
- ✅ Fully decoded the animation blob layout (hierarchy + D×B frame index lists + pose records); header counts =
  (nodes, bones, mesh parts, frames).

**Not verified**
- Vertex indices exceed per-part vertex counts (shared pool), so full models can't be assembled yet.
- Face→texture mapping (meaning of `id`, CLUT/tpage), vertex scale/handedness, the 12-byte gap before the second face list.
- Only 3 parts were inspected visually; most of the 395 parsed parts are unchecked.

**Next**
1. Solve global vertex indexing (try: pool = parts' vertices concatenated in blob order, or with each part's bone
   transform from the pose table applied) and assemble one whole model at pose 0.
2. Map faces to textures; locate the texture record each model uses.
3. Add a three.js model viewer loading `public/assets/models/*.json` (needs `npm install` locally to test).

## Turn 4 – 2026-11-24
**Done**
- ✅ Found the file is **PlayStation game data** (PS1 strings in the exe; explains BGR555/GTE fixed point).
- ✅ Mapped BLAZE.ALL: UI textures → big pack block (sectors 1021–3368) → ~10 per-level blocks.
- ✅ **Pack format** (`u32 n; u32 offsets[n]`) and **0x40-header blobs** (695; size rule holds 576/580) – these hold
  skeletal **animation pose tables** (rot/trans/scale per bone, 4096=360°). `tools/scan_packs.py` → `data/packs.json`.
- ✅ **Game text** extracted (menus, item descriptions, NPC dialogue, signs): `tools/extract_text.py` →
  `data/text_dump.tsv` (10.7k runs, heuristic).
- ❌ Web search found no public docs on this game's formats – reversing it ourselves.

**Not verified**
- Meaning of the four header counts; where meshes/UVs/faces live; level tilemaps; text indexing (string tables).
- Packs.json may include false positives (494 pack-like headers; some are not real packs).

**Next**
1. Locate mesh geometry (vertex/face lists) – look at blobs whose body is not a pose table and at the 16-byte
   `0x10000000` records; cross-check with tile-atlas textures.
2. Reverse the level format: height-map grids + tile index maps per level block; render a static terrain with the
   tile atlas in three.js.
3. Add a three.js asset viewer (textures, text, animation skeleton) to the app.

## Turn 3 – 2026-11-24
**Done**
- ✅ Scanned all 503 palette records; found the pixel-header layout (height field → exact row count).
- ✅ **Fixed palette format: BGR555 + opaque bit** (not RGB565) by cross-checking against the decoded `make_01e.bmp`.
  The earlier "ghost" in the logo was just wrong colours.
- ✅ `tools/dump_textures.py` → 493 textures in `public/assets/tex/` (+ `index.json`; 10 odd-header records skipped).
  Contact sheet shows face/hair sheets, monster skins, spell icons, fonts, **numbered tile atlases**, minimaps, sky.

**Not verified**
- Header fields `A,B`; what the extra data after each texture is (records are far larger than the pixels in many
  cases, e.g. sector 33: 177 KB vs 57 KB of pixels); the 10 skipped records; which texture belongs to which level.

**Next**
1. Classify the non-texture chunks that follow textures (the `(n,0)` small-typed records at sectors ~1030–3400 look like
   tables/meshes) – find their header layout.
2. Disassemble `Blaze.exe` CD-read path to find the sector→asset table and chunk type ids.
3. Try to identify level/tilemap data (look for arrays referencing the numbered tile atlases) and model vertex data.

## Turn 2 – 2026-11-24
**Done**
- ✅ Cracked `.pic`: LHA level-1 + lh5 with method bytes `xxxxx`. `tools/lh5.py` decoder (CRC-verified on all 3 files),
  `tools/decode_pics.py` → `public/assets/ui/*.png` (menu background, window frame, bitmap font).
- ✅ `BLAZE.ALL` record 0 pixels are **raw 8-bit paletted, 256 px/row** – logo texture now readable (not compressed;
  earlier "compressed" guess was wrong). Compression is therefore not the blocker for BLAZE.ALL.
- ❌ Could not fetch the full ISO (sandbox network blocks myabandonware.com); proceeding with the RIP.

**Not verified**
- Ghost/overlap in the logo texture; meaning of record header fields (`640`, `0x80`); record boundaries/index.

**Next**
1. Build a record scanner that walks all palette chunks in `BLAZE.ALL` and dumps every texture as PNG (contact sheet)
   to learn what asset types exist.
2. Find the table in `Blaze.exe` that maps sector numbers → assets (cd.idx replacement); disassemble the CD reader.
3. Classify non-image records (models/levels/anims), starting with the small (1..60, 0) typed records near sectors
   1030-3400.

## Turn 1 – 2026-11-24
**Done**
- Unpacked the rip and inventoried it (see `docs/FORMATS.md`): music (`musik/*.wav`) and videos (`*.avi`) are
  **empty stubs** in this rip; real data is `BLAZE.ALL`, `Snd/*.snd`.
- ✅ Cracked `.snd` format; `tools/extract_snd.py` converts all 79 banks → 744 WAV clips (`public/assets/snd/`)
  with a `manifest.json`. 
- ✅ Identified `BLAZE.ALL` palette chunks (256 × RGB565).
- Found `bbpool.rsc` (59 MB) is noise-like, unreferenced by any binary → treated as decoy for now.
- Scaffolded Vite + TypeScript + three.js app: placeholder scene + sound-bank browser (`src/`).
- Original small files kept under `original/` for reference.

**Not verified**
- `npm install`/`vite build` could **not** be run (sandbox had no package-registry access). Only
  `src/audio/sndBank.ts` was typechecked. Run `npm install && npm run dev` locally to try the scaffold.
- Sample rate of `.snd` (22050 assumed).

**Next**
1. Decode pixel compression in `BLAZE.ALL` (disassemble `Unpack` @ wsyskern.dll 0x3e70) → extract all 2D art.
2. Locate record/file index inside `Blaze.exe` (sector tables) and classify record types (models, maps, anims).
3. Reverse the 3D model + level formats; get a static level rendering in three.js.
4. Then: player movement/camera, combat, enemies, items/spells, quest flow, audio (music is missing – needs
   a source or placeholder).

**Open questions for owner**
- Music/videos are missing from this rip; is there a fuller copy (or should we ship silent/placeholder music)?
