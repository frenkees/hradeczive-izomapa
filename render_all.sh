#!/bin/sh
# vyrenderuje všechny čtverce, které mají připravenou scénu (prep.py): ./render_all.sh [varianty]
set -e
if [ -f .venv/bin/activate ]; then . .venv/bin/activate; else . .venv/Scripts/activate; fi   # Windows: Scripts
for c in $(python -c "import geo, os; print(' '.join(f'{i},{j}' for i, j in geo.CHUNKS if os.path.exists(geo.chunk_dir((i, j)) + '/scene.json')))"); do
  ./render_chunk.sh $c "$@"
done
