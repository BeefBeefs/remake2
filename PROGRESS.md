# Progress log

Goal: playable TypeScript/three.js web port of *Blaze & Blade: Eternal Quest* (Win EN). Repo will go private
later. Newest entry first; each work session appends here.

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

**Next**: find why ~1/3 of parts fail the subheader check (heroes 3, 8, 13, 15), the remaining out-of-range faces, name the animations, then monsters/NPCs and level data.

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
