# Progress log

Goal: playable TypeScript/three.js web port of *Blaze & Blade: Eternal Quest* (Win EN). Repo will go private
later. Newest entry first; each work session appends here.

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
