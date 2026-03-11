#!/bin/bash
#
# Society Protocol - Bootstrap Node Setup
# Uso: curl -fsSL https://society.computer/setup-bootstrap.sh | bash
#

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configurações
NODE_VERSION="20"
SOCIETY_USER="society"
SOCIETY_DIR="/home/${SOCIETY_USER}/society"
INSTALL_DIR="${SOCIETY_DIR}/core"
DATA_DIR="/home/${SOCIETY_USER}/.society"
PORT="${PORT:-4001}"
WS_PORT="${WS_PORT:-4002}"
NODE_NAME="${NODE_NAME:-bootstrap}"

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║     Society Protocol - Bootstrap Node Setup            ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Detectar OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$NAME
else
    log_error "Não foi possível detectar o sistema operacional"
    exit 1
fi

log_info "Sistema detectado: $OS"

# 1. Atualizar sistema
log_info "Atualizando pacotes do sistema..."
if command -v apt-get &> /dev/null; then
    apt-get update -qq
    apt-get upgrade -y -qq
elif command -v yum &> /dev/null; then
    yum update -y -q
elif command -v dnf &> /dev/null; then
    dnf update -y -q
else
    log_warn "Gerenciador de pacotes não reconhecido"
fi

# 2. Instalar dependências
log_info "Instalando dependências..."
if command -v apt-get &> /dev/null; then
    apt-get install -y -qq curl git build-essential python3
elif command -v yum &> /dev/null; then
    yum install -y curl git gcc-c++ make python3
elif command -v dnf &> /dev/null; then
    dnf install -y curl git gcc-c++ make python3
fi

# 3. Instalar Node.js
log_info "Instalando Node.js ${NODE_VERSION}..."
if ! command -v node &> /dev/null; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y -qq nodejs
else
    CURRENT_NODE=$(node --version | cut -d'v' -f2)
    log_info "Node.js já instalado: v${CURRENT_NODE}"
fi

# Verificar instalação
if ! command -v node &> /dev/null; then
    log_error "Falha ao instalar Node.js"
    exit 1
fi

NODE_VERSION_INSTALLED=$(node --version)
log_success "Node.js instalado: ${NODE_VERSION_INSTALLED}"

# 4. Criar usuário society
if ! id "$SOCIETY_USER" &>/dev/null; then
    log_info "Criando usuário ${SOCIETY_USER}..."
    useradd -m -s /bin/bash "$SOCIETY_USER"
    log_success "Usuário ${SOCIETY_USER} criado"
else
    log_info "Usuário ${SOCIETY_USER} já existe"
fi

# 5. Clonar repositório
log_info "Clonando Society Protocol..."
if [ -d "$INSTALL_DIR" ]; then
    log_warn "Diretório ${INSTALL_DIR} já existe, atualizando..."
    su - "$SOCIETY_USER" -c "cd $INSTALL_DIR && git pull"
else
    su - "$SOCIETY_USER" -c "git clone https://github.com/society/society.git $SOCIETY_DIR"
fi

# 6. Instalar dependências e buildar
log_info "Instalando dependências npm (pode levar alguns minutos)..."
su - "$SOCIETY_USER" -c "cd $INSTALL_DIR && npm install --silent"

log_info "Buildando projeto..."
su - "$SOCIETY_USER" -c "cd $INSTALL_DIR && npm run build"

# 7. Criar diretório de dados
mkdir -p "$DATA_DIR"
chown "$SOCIETY_USER:$SOCIETY_USER" "$DATA_DIR"

# 8. Criar script de start
cat > /home/${SOCIETY_USER}/start-society.sh << EOF
#!/bin/bash
# Society Protocol Bootstrap Node

export NODE_ENV=production
export SOCIETY_LOG_LEVEL=info

cd ${INSTALL_DIR}

exec node dist/index.js node \\
    --name "${NODE_NAME}" \\
    --port ${PORT} \\
    --room "bootstrap-discovery" \\
    --db "${DATA_DIR}/bootstrap.db" \\
    --gossipsub \\
    --dht \\
    --debug
EOF

chmod +x /home/${SOCIETY_USER}/start-society.sh
chown "$SOCIETY_USER:$SOCIETY_USER" /home/${SOCIETY_USER}/start-society.sh

log_success "Script de start criado"

# 9. Configurar firewall
log_info "Configurando firewall..."
if command -v ufw &> /dev/null; then
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp comment 'SSH'
    ufw allow ${PORT}/tcp comment 'Society P2P'
    ufw allow ${WS_PORT}/tcp comment 'Society WebSocket'
    
    # Habilitar sem confirmação
    echo "y" | ufw enable
    
    log_success "UFW configurado"
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --permanent --add-port=${PORT}/tcp
    firewall-cmd --permanent --add-port=${WS_PORT}/tcp
    firewall-cmd --reload
    log_success "Firewalld configurado"
else
    log_warn "Firewall não configurado automaticamente"
fi

# 10. Criar systemd service
cat > /etc/systemd/system/society-bootstrap.service << EOF
[Unit]
Description=Society Protocol Bootstrap Node
After=network.target

[Service]
Type=simple
User=${SOCIETY_USER}
WorkingDirectory=/home/${SOCIETY_USER}
ExecStart=/home/${SOCIETY_USER}/start-society.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=society-bootstrap

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable society-bootstrap

log_success "Systemd service criado"

# 11. Criar script de health check
cat > /home/${SOCIETY_USER}/health-check.sh << 'EOF'
#!/bin/bash
# Society Health Check

PID=$(pgrep -f "node dist/index.js node" || true)

if [ -z "$PID" ]; then
    echo "❌ Society node não está rodando"
    exit 1
fi

# Verificar porta
if ! nc -z localhost 4001 2>/dev/null; then
    echo "❌ Porta 4001 não está respondendo"
    exit 1
fi

echo "✅ Society node está saudável (PID: $PID)"
exit 0
EOF

chmod +x /home/${SOCIETY_USER}/health-check.sh
chown "$SOCIETY_USER:$SOCIETY_USER" /home/${SOCIETY_USER}/health-check.sh

# 12. Iniciar serviço
log_info "Iniciando Society Bootstrap..."
systemctl start society-bootstrap

# Aguardar inicialização
sleep 3

# Verificar status
if systemctl is-active --quiet society-bootstrap; then
    log_success "Society Bootstrap iniciado com sucesso!"
else
    log_error "Falha ao iniciar Society Bootstrap"
    systemctl status society-bootstrap --no-pager
    exit 1
fi

# 13. Mostrar informações
IP_ADDRESS=$(hostname -I | awk '{print $1}')
PEER_ID=$(su - "$SOCIETY_USER" -c "cd $INSTALL_DIR && node -e \"const {Storage} = require('./dist/storage.js'); const s = new Storage({dbPath: '${DATA_DIR}/bootstrap.db'}); const id = s.getIdentity(); console.log(id ? id.did : 'N/A')\"" 2>/dev/null || echo "N/A")

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║           Setup Completo! 🎉                           ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📊 Informações do Node:"
echo "  IP: ${IP_ADDRESS}"
echo "  Porta: ${PORT}"
echo "  WebSocket: ${WS_PORT}"
echo "  Peer ID: ${PEER_ID}"
echo ""
echo "📂 Diretórios:"
echo "  Instalação: ${INSTALL_DIR}"
echo "  Dados: ${DATA_DIR}"
echo "  Logs: journalctl -u society-bootstrap -f"
echo ""
echo "🎮 Comandos úteis:"
echo "  Ver status:   sudo systemctl status society-bootstrap"
echo "  Ver logs:     sudo journalctl -u society-bootstrap -f"
echo "  Restart:      sudo systemctl restart society-bootstrap"
echo "  Stop:         sudo systemctl stop society-bootstrap"
echo "  Health check: /home/${SOCIETY_USER}/health-check.sh"
echo ""
echo "🔗 Multiaddrs para bootstrap:"
echo "  /ip4/${IP_ADDRESS}/tcp/${PORT}"
echo "  /dns4/$(hostname -f)/tcp/${PORT}"
echo ""
echo "⚠️  Importante:"
echo "  Anote o Peer ID acima para configurar no DNS!"
echo "  Para ver o Peer ID novamente:"
echo "  sudo grep 'identity' ${DATA_DIR}/bootstrap.db 2>/dev/null || echo 'Ver logs com: sudo journalctl -u society-bootstrap | grep identity'"
echo ""
