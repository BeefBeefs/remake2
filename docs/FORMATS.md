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

## Engine hints (wsyskern.dll)
* Exports include `Unpack` (0x3e70) – probable decompressor for `.pic`/BLAZE.ALL data – and `decrypt` (0x77c0):
  checks magic `0x9DE29BEE`, derives a key from a 9-byte table at 0x10049B88, per-byte `ror`/xor stream. Applies to
  memory blocks carrying that magic (likely embedded scripts/resources), **not** to `bbpool.rsc`.
* `.inter` section (0x260C0 bytes) + `WinSys*`/`EvalExpression` exports = bytecode/script interpreter. The
  game's UI/flow may be script-driven.
* Rendering: `winsys3d.dll` (3D sprites, matrices) + `3dhelp.dll`/`gldhelp.dll`; texture API names:
  `ReleaseTexture`, `SetTextureFilterMode`, `Zoom8BitTextures` → 8-bit palettised textures.
