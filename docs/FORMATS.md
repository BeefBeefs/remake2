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
| `English/data/*.pic` | small | 🟡 compressed bitmaps; header has original name (`font.bmp`, `make_01e.bmp`, `sys_wi2e.bmp`). Installer/menu UI only. |
| `data/Starter/*.par`, `VAR.INF` | tiny | Installer scripts in the WinSys script language. Not game logic. |

## Snd/*.snd ✅
Table of N × `(offset:u32, size:u32)` LE pairs. Offsets chain back-to-back, relative to end of the table.
`8*N + Σsize == file size` for all 79 banks (744 non-empty clips). Payload is 8-bit unsigned mono PCM
(`0x80` = silence). Sample rate is not stored; 22050 Hz is an assumption – verify by ear.
Implemented in `tools/extract_snd.py`. Naming: `Base.snd` = shared SFX; `Qxx_yy.snd` = quest xx, part yy.

## English/BLAZE.ALL 🟡
* Sector-aligned records. Many begin with a chunk header `u32 16, u32 8|9, u32 size` (524 or 2060 bytes)
  holding a **256-colour RGB565 palette** (`u16 0, u16 480(?), u16 256, u16 1, pal[256]`) – ✅ palette decodes to
  sensible colours (see `tools/probe_img.py`).
* Following the palette: `u16 12, u16 1, u32 640, u32 0x01000080` then pixel data. Pixel data of the first
  record (a 640×480 title graphic) is **not** plain 8-bit rows; likely RLE/LZ-compressed. ❓ algorithm.
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
