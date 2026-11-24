# Original file formats (Blaze & Blade: Eternal Quest, Win EN rip)

Publisher chain per registry key: T&E Software / Funsoft / Elo Interactive Media. Engine = "WinSys"
(`wsyskern.dll`, `winsys3d.dll`, `playst.dll`). Status legend: ✅ verified, 🟡 partial, ❓ unknown.

## Rip contents (what is real vs stubbed)
| Path | Size | Notes |
|---|---|---|
| `Blaze.exe` (+`Fix/blaze.exe`, same size) | 1.5 MB | Native x86 game. Loads `wsyskern.dll`, `winsys3d.dll`; D3D via DirectDraw. |
| `English/BLAZE.ALL` | 46 MB | ISO-9660-style `BLAZE.ALL;1` CD data file, 22563 × 2048-byte sectors. Main game data. |
| `data/bbpool.rsc` | 59 MB | See below – likely filler. |
| `Snd/*.snd` | 10 MB | ✅ sound banks (below). Exe refs: `q:\snd\Q%02d_%02d.snd`, `\\snd\Base.snd`. |
| `musik/*.wav` | 56 B each | **Stubs** – RIP removed music. Exe expects `Music/Mel00_01.WAV` … `Bos10_01.WAV`, `Title01`, `Menu`, `GameOver`, `End01`. |
| `English/*.avi` | 2.5 KB each | **Stubs** – intro/ending/etc. videos removed. |
| `cd.idx` | 0 B | Empty (probably the CD TOC index – lost). |
| `English/data/*.txt` | small | ✅ UI strings (`config.txt`, `action.txt`, `keyboard.txt`, `english.txt`, `joystick.txt`). Action list: Up/Down/Left/Right, Attack/Action, Special, Jump, Icon, Turn L/R, Look up/down, Menu, Cast spell, Zoom in/out, AutoCamera, Topview. |
| `English/data/*.pic` | small | ✅ LHA lh5 (see below) → 8-bit BMPs (`font.bmp` 312×84, `make_01e.bmp` and `sys_wi2e.bmp` 256×256). Decoded to `public/assets/ui/`. |
| `data/Starter/*.par`, `VAR.INF` | tiny | Installer scripts in the WinSys script language. Not game logic. |

## .pic ✅ (LHA lh5)
LHA **level-1** member whose 5-byte method field is overwritten with `xxxxx` (so stock `lha` refuses it).
Header: `u8 hdrsize, u8 csum, method[5], u32 packed, u32 orig, u32 time, u8 attr, u8 level(=1), u8 namelen, name, u16 crc16`
(+ OS byte, `u16 ext=0`); payload at `hdrsize+2`. Payload = standard **-lh5-** (8 KiB window, NC=510, NT=19, NP=14,
min match 3) — identified from `wsyskern.dll` Unpack (0x3e70 → worker 0x3480; window 0x2000, c-table 0x1fe, length = code−253).
CRC16 (poly 0xA001) over the output matches on all 3 files. Implemented in `tools/lh5.py`, `tools/decode_pics.py`.
`BLAZE.ALL` does **not** use this wrapper (`xxxxx` hits there are random data).

## Snd/*.snd ✅
Table of N × `(offset:u32, size:u32)` LE pairs. Offsets chain back-to-back, relative to end of the table.
`8*N + Σsize == file size` for all 79 banks (744 non-empty clips). Payload is 8-bit unsigned mono PCM
(`0x80` = silence). Sample rate is not stored; 22050 Hz is an assumption – verify by ear.
Implemented in `tools/extract_snd.py`. Naming: `Base.snd` = shared SFX; `Qxx_yy.snd` = quest xx, part yy.

## English/BLAZE.ALL 🟡
* Sector-aligned records. 503 begin with a chunk header `u32 16, u32 8|9, u32 psize` (psize 524 = 256 colours,
  1036 = 512, 2060 = 1024, 44 = 16) holding palette data. ✅ **Palette entries are u16 BGR555**: `R=v&31, G=(v>>5)&31,
  B=(v>>10)&31`, bit 15 = opaque flag (0 = transparent). Verified against `make_01e.bmp` (record at sector 33 is the
  same image; 87.5 % of indices identical, colours match exactly). (An earlier RGB565 guess was wrong.)
* Pixel header at `record + psize + 8`: `u8 12, u16 height, u8 0, u32 640|768|0, u16 A, u16 B`. ✅ `height` rows ×
  256 bytes follows 12 bytes later (e.g. 256×128 = 32768 + 1504 pad = record size). `A,B` (64/128/16 and 256/64/224)
  unknown – maybe tile/cell size. 10 records have a different header size (140/204) and are skipped for now.
* ✅ `tools/dump_textures.py` extracts 493 textures (256×H RGBA) → `public/assets/tex/` + `index.json`. Contents seen:
  character face/hair sheets, monster skins (skull, lava), 6×6 spell-icon sheet, bitmap fonts, **numbered tile
  atlases** (level geometry is tile-based), minimaps (drawn twice side by side), sky/starfield, title logo.
* ✅ Pixel data is raw 8-bit palette indices, 256 px per row. Record 0 = title logo texture.
* Huge runs of `0xCC` (MSVC debug fill) and zeros appear → sparse/padded records; `cd.idx` (the index) is missing,
  so record boundaries must be recovered by scanning or from hard-coded sector numbers in `Blaze.exe`.
* Remaining record types (models, level data, animations) ❓.

## data/bbpool.rsc ❓ (probably decoy)
59.3 MB, byte entropy 7.83 everywhere, tail zero-padded. Every aligned 32-bit word is a pair of 16-bit values
that differ by at most ±2 (100 % of sampled pairs) – a signature of deliberately generated noise, not of
compressed data. **No binary in the rip references `bbpool` or `.rsc`** (searched exe + all DLLs). Working
theory: CD copy-protection / filler file. Not needed unless a loader is found.

## Origin: this is the PlayStation game's data
`Blaze.exe` references `MUSIC00.XA;1`…`MUSIC04.XA;1`, `BLAZE.ALL;1`, `SYSTEM.INI;1`, `Blaze-Saving` (memory-card
save) and the menu text offers "Memory Card Utility" – the PC build is a port of the PS1 title. Consistent with that:
BGR555+STP-bit palettes, 256-wide texture pages, `0x1000 = 1.0` fixed point (GTE), 4096 = 360° angles.
`cd.idx` (empty in the rip) is a path the exe uses for a CD index/cache. No public documentation of the formats was found.

## BLAZE.ALL layout (map) 🟡
* sectors 0–~1020: UI/shared textures (palette record + pixels, back to back).
* sectors ~1021–3368: one 2347-sector block of **packs** (non-texture): items/monsters/animations/text.
* sectors ~3385–22563: ~10 per-level blocks (one tile-atlas texture roughly every 150–200 sectors, plus packs, text,
  height maps). `data/packs.json` lists the 494 sector-aligned packs found.

### Packs 🟡
`u32 n; u32 offset[n]` (offset[0]=0, ascending; relative to end of table = 4+4n), then blobs.
* **Animation blob** (695 found, header `0x40`): `u32 hdrsize=0x40; u32 bodysize` with `hdrsize+bodysize == blob
  length` (576 of 580 checked). Header u16 @0x10: four counts **(A, B, C, D)** (e.g. 61,41,20,7 or 86,59,27,14);
  u32 @0x20: offset (e.g. 0x2bc) of the pose table inside the body. Body, ✅ decoded: `hierarchy[A+2] u16` (starts
  `-1,-1,0,0,1,2,…`), then **D lists of B u16** (per frame: pose-record index for each of the B bones), then
  **16-byte pose records** `i16 rot[3] (4096=360°), i16 0, i16 trans[3], i16 scale (4096)`. C = number of mesh parts
  (blobs) in the sibling mesh pack, D = number of frames. Size check: pack 3501 blob 0 = 176 + 14·59·2 + 114·16.

### Mesh part blobs ✅ (layout) / 🟡 (indexing)
Found in 23 packs (sectors ~2764–3521; e.g. pack 3521 has 27 parts = C of its animation pack at 3501). 395 blobs
parse so far. Layout (`tools/meshparse.py`):
`[F1 face rows][subheader @h, 16-aligned, found by w7==0x40][V vertices @h+w7-4][N normals @h+w8-4][4 B][F2 face rows @h+w9]`
* face row (16 B): `u8 id[4]`, `u8 uv[4][2]` (PS1 texture-page coords), `u8 vidx[4]` – textured quad (repeated index = tri).
* vertex: `i16 x,y,z,0` (small ints, about ±60); normal: `i16 x,y,z,0`, 4096 = 1.0. `V=(w8-w7)/8` (= low half of subheader word 1), `N=(w9-w8)/8`, and
  **#faces == N** in every parsed blob. Visual check: part 26 of pack 3521 is a sword.
* ❓ Face vertex indices often exceed V (up to 88 for a 59-vertex part): they index a model-wide pool (shared joints).
  ❓ Which texture/CLUT a face uses (`id`?); how parts map onto bones.
* Other blob kinds: ASCII text blobs ('Mage…', 'Hell…'), height-map-like byte grids (32-byte rows: 24 data bytes + pad),
  record tables of 16 bytes with `0x10000000` fixed-point fields – ❓.

### Text ✅ (found, not yet structured)
Plain ASCII, `\r` line breaks, in: main menu (Begin Game / Create Characters / Memory Card Utility / Object Utility),
item name/description pairs (`Name/Description.\r(Effect)`, fixed 640-byte stride in some blocks), spell descriptions,
inn/shop text, NPC dialogue (`Speaker:\rLine`), signs. `tools/extract_text.py` → `data/text_dump.tsv` (heuristic filter;
some image-data noise remains near sector 663).

## Engine hints (wsyskern.dll)
* Exports include `Unpack` (0x3e70) – probable decompressor for `.pic`/BLAZE.ALL data – and `decrypt` (0x77c0):
  checks magic `0x9DE29BEE`, derives a key from a 9-byte table at 0x10049B88, per-byte `ror`/xor stream. Applies to
  memory blocks carrying that magic (likely embedded scripts/resources), **not** to `bbpool.rsc`.
* `.inter` section (0x260C0 bytes) + `WinSys*`/`EvalExpression` exports = bytecode/script interpreter. The
  game's UI/flow may be script-driven.
* Rendering: `winsys3d.dll` (3D sprites, matrices) + `3dhelp.dll`/`gldhelp.dll`; texture API names:
  `ReleaseTexture`, `SetTextureFilterMode`, `Zoom8BitTextures` → 8-bit palettised textures.


## Resource table (hero models)
BLAZE.ALL holds `(u32 sector, u32 size)` pairs at file offset 0x906b88 (copies at 0x907388, …; see `data/resource_table.json`):
5 misc textures, then 16 hero textures (sectors 120..270), 16×2592 B blobs, 8×6400 B blobs, 16 animation packs, 16 mesh packs.
Entry *k* of each list belongs to hero *k* (hero 0 = knight: texture 120, anim pack 3501, mesh pack 3521).
Hero texture records have 4 CLUTs of 256 colours (palette block 2048 B at +0x14, psize 2060) and a 256x64 image; model UVs index that image directly.
