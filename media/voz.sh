#!/bin/bash
# Genera la voz desde narracion.txt (ElevenLabs): assets/voz.mp3 + assets/voz.json (tiempos por carácter).
# Cada línea de narracion.txt es un subtítulo; a la voz se le manda todo unido por espacios.
# La clave se lee del Llavero en memoria; no se imprime ni se guarda.
# Uso: ./voz.sh [voice_id] [model_id] [salida_sin_extension]   → después: python3 sincronizar.py
set -euo pipefail
cd "$(dirname "$0")"
VOZ="${1:-fxEPMjHccsIr94VUOijN}" # Javier - Amable y Cercano (latino)
MODELO="${2:-eleven_v3}"
OUT="${3:-assets/voz}"
K=$(security find-generic-password -s ELEVENLABS_API_KEY -w)
REQ=$(mktemp); RES=$(mktemp); trap 'rm -f "$REQ" "$RES"' EXIT
python3 -c "
import json,sys
t=' '.join(open('narracion.txt').read().split('\n')).strip()
b={'text':t,'model_id':sys.argv[2]}
if sys.argv[3]: b['voice_settings']={'speed':float(sys.argv[3]),'stability':0.5,'similarity_boost':0.75}
json.dump(b,open(sys.argv[1],'w'))" "$REQ" "$MODELO" "${VELOCIDAD:-}"
curl -sS --fail-with-body -o "$RES" -X POST "https://api.elevenlabs.io/v1/text-to-speech/$VOZ/with-timestamps?output_format=mp3_44100_192" \
  -H "xi-api-key: $K" -H "Content-Type: application/json" --data-binary @"$REQ" || { head -c 400 "$RES"; exit 1; }
python3 -c "
import json,base64,sys
d=json.load(open(sys.argv[1])); o=sys.argv[2]
open(o+'.mp3','wb').write(base64.b64decode(d['audio_base64']))
json.dump(d['alignment'],open(o+'.json','w'))
print('voz', o, d['alignment']['character_end_times_seconds'][-1], 's')" "$RES" "$OUT"
