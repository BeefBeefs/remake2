#!/bin/sh
# Re-encode the disc's music (MS-ADPCM 22.05 kHz stereo WAV in Music/) to AAC for the web and write the manifest.
# usage: tools/convert_music.sh <dir with the WAVs> [out dir]   (names are lower-cased: Mel05_02.WAV -> mel05_02.m4a)
set -e
src="$1"; out="${2:-public/assets/music}"
mkdir -p "$out"
for f in "$src"/*; do
  case "$f" in *.wav|*.WAV) ;; *) continue ;; esac
  n=$(basename "$f"); n=$(echo "${n%.*}" | sed 's/^[0-9a-fA-F]\{8\}-//' | tr 'A-Z' 'a-z')   # uploads carry an 8-hex-digit prefix
  case "$n" in bos*|mel*|menu|title01|gameover|end01|logosnd) ;; *) continue ;; esac
  ffmpeg -v error -y -i "$f" -c:a aac -b:a 56k -movflags +faststart "$out/$n.m4a"
done
(cd "$out" && ls *.m4a | sed 's/\.m4a$//' | python3 -c "import sys,json; print(json.dumps(sorted(l.strip() for l in sys.stdin)))" > index.json)
echo "music: $(cat "$out/index.json")"
