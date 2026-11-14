#!/bin/sh
# jeden čtverec celý: prep -> render (všechny varianty) -> dzi; volá ho render_par.sh
# časy fází (prep / render / dzi) se zapisují do build/render_par.log
cd "$(dirname "$0")"
if [ -f .venv/bin/activate ]; then . .venv/bin/activate; else . .venv/Scripts/activate; fi
export PYTHONUTF8=1
c=$1; if [ "$c" = "0,0" ]; then D=data; else D=data_c$(echo $c | tr "," "_"); fi
t=$(date +%s)
L=build/ctverec_$(echo $c | tr "," "_").log      # chyby nezahazovat: log čtverce zůstává pro dohledání
python prep.py $D $c > $L 2>&1 || { echo "CHYBA prep $c (viz $L)" | tee -a build/render_par.log; exit 1; }
t1=$(date +%s)
./render_chunk.sh $c >> $L 2>&1 || { echo "CHYBA render $c (viz $L)" | tee -a build/render_par.log; exit 1; }
t2=$(date +%s)
if [ "$c" = "0,0" ]; then python dzi.py >> $L 2>&1; else python dzi.py --chunk $c >> $L 2>&1; fi || { echo "CHYBA dzi $c (viz $L)" | tee -a build/render_par.log; exit 1; }
t3=$(date +%s)
echo "hotovo $c za $(( t3 - t )) s (prep $(( t1 - t )) s, render $(( t2 - t1 )) s, dzi $(( t3 - t2 )) s)" | tee -a build/render_par.log
