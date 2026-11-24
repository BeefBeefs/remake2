# Progress log

Goal: playable TypeScript/three.js web port of *Blaze & Blade: Eternal Quest* (Win EN). Repo will go private
later. Newest entry first; each work session appends here.

### Turn 9 (continues; notes after each step)
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
