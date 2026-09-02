#!/usr/bin/env bash
# Setup del bot RE/MAX Data House en un servidor Ubuntu (Google Cloud / VPS).
set -e
echo "=== [1/7] Actualizando sistema ==="
sudo apt-get update -y
echo "=== [2/7] Swap de 2GB (para VM con poca RAM) ==="
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile; sudo mkswap /swapfile; sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
echo "=== [3/7] Instalando Node.js 20 LTS ==="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "node: $(node -v)"
echo "=== [4/7] Instalando git y pm2 ==="
sudo apt-get install -y git
sudo npm install -g pm2
echo "=== [5/7] Clonando el repo ==="
cd ~
[ -d ~/remax-bot ] || git clone https://github.com/danielagr-cell/agente-remax-data-house.git remax-bot
cd ~/remax-bot && git pull --ff-only 2>/dev/null || true
echo "=== [6/7] Instalando dependencias ==="
npm install
echo "=== [7/7] Plantilla .env ==="
[ -f .env ] || cp .env.example .env 2>/dev/null || touch .env
echo ""
echo "=================================================="
echo " LISTO: Node + dependencias + pm2 instalados."
echo " Carpeta del bot: ~/remax-bot"
echo " Falta cargar claves en ~/remax-bot/.env y arrancar."
echo "=================================================="
