#!/bin/bash
# 🚀 Launcher macOS del Retro Console SDK Bridge (doppio-clic dal Finder)
#
# Avvia il server Bun reale, apre il browser sullo studio e lascia il
# terminale aperto coi log veri (chiudi la finestra = server spento).
# Nessuna app finta: se Bun manca, dice davvero come installarlo.

cd "$(dirname "$0")/.." || exit 1
DIR_NAME="$(basename "$PWD")"
URL="http://localhost:3014"

echo "======================================================"
echo "🎮 Retro Console SDK Bridge — launcher macOS"
echo "   cartella: $PWD"
echo "======================================================"

# 1. Bun installato?
if ! command -v bun >/dev/null 2>&1; then
  echo ""
  echo "✗ Bun non è installato su questo Mac."
  echo "  Installalo davvero con uno di questi comandi, poi riapri questo file:"
  echo ""
  echo "    brew install oven-sh/bun/bun"
  echo "    curl -fsSL https://bun.sh/install | bash"
  echo ""
  echo "Premi un tasto per chiudere…"
  read -n 1 -s
  exit 1
fi

# 2. Dipendenze installate? (node_modules mancante → bun install reale)
if [ ! -d node_modules ]; then
  echo "📦 Prima esecuzione: installo le dipendenze reali (bun install)…"
  bun install || { echo "✗ bun install fallito."; read -n 1 -s; exit 1; }
fi

# 3. Server già avviato? (double-click ripetuto: apri e basta, onestamente)
if curl -s -o /dev/null --max-time 1 "$URL"; then
  echo "✓ Il server è già in esecuzione su $URL — apro il browser."
  open "$URL"
  sleep 2
  exit 0
fi

# 4. Avvio reale: server in background + browser appena risponde
echo "🚀 Avvio il server reale…"
bun server.ts &
SERVER_PID=$!

# aspetta fino a 15 secondi che il server risponda davvero
for i in $(seq 1 30); do
  if curl -s -o /dev/null --max-time 1 "$URL"; then
    echo "✓ Server attivo su $URL — apro il browser."
    open "$URL"
    break
  fi
  sleep 0.5
done

echo ""
echo "Lo studio è su: $URL"
echo "Questo terminale mostra i log reali del server."
echo "Chiudi QUESTA finestra per spegnere il server."
echo "======================================================"

# consegna il terminale al server: Ctrl+C o chiusura finestra = stop
wait $SERVER_PID
