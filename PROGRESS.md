# Progress log

Goal: playable TypeScript/three.js web port of *Blaze & Blade: Eternal Quest* (Win EN). Repo will go private
later. Newest entry first; each work session appends here.

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
