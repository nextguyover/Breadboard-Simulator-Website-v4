#!/bin/sh
# Renders every frame the site uses into render/out (about three hours on 4 CPU cores).
set -e
cd "$(dirname "$0")"
PY=${PY:-python3}
SIZE=${SIZE:-2560x1440}
SAMPLES=${SAMPLES:-48}
$PY anim.py out/a --size $SIZE --samples $SAMPLES
$PY anim.py out/b --size $SIZE --samples $SAMPLES --turn 36:50 --glow off --prefix off
$PY anim.py out/b --size $SIZE --samples $SAMPLES --turn 36:50 --glow on --prefix on
