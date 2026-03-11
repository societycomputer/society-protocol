#!/bin/bash
#
# Gerar DNS TXT record para Society bootstrap
# Uso: ./generate-dns-txt.sh <peer1_id> <peer2_id> <peer3_id>
#

set -e

if [ $# -lt 3 ]; then
    echo "Uso: $0 <peer1_id> <peer2_id> <peer3_id>"
    echo ""
    echo "Exemplo:"
    echo "  $0 12D3KooWABC... 12D3KooWDEF... 12D3KooWGHI..."
    echo ""
    echo "Para descobrir o Peer ID de um node rodando:"
    echo "  journalctl -u society-bootstrap | grep 'PeerId' | head -1"
    exit 1
fi

PEER1_ID=$1
PEER2_ID=$2
PEER3_ID=$3

TIMESTAMP=$(date +%s)000  # milliseconds

# Criar JSON de peers
read -r -d '' PEERS_JSON << EOF
[
  {
    "id": "${PEER1_ID}",
    "addrs": [
      "/dns4/bootstrap1.society.computer/tcp/4001",
      "/dns4/bootstrap1.society.computer/tcp/4002/ws"
    ],
    "lastSeen": ${TIMESTAMP},
    "latency": 0,
    "reliability": 0.95
  },
  {
    "id": "${PEER2_ID}",
    "addrs": [
      "/dns4/bootstrap2.society.computer/tcp/4001",
      "/dns4/bootstrap2.society.computer/tcp/4002/ws"
    ],
    "lastSeen": ${TIMESTAMP},
    "latency": 0,
    "reliability": 0.95
  },
  {
    "id": "${PEER3_ID}",
    "addrs": [
      "/dns4/bootstrap3.society.computer/tcp/4001",
      "/dns4/bootstrap3.society.computer/tcp/4002/ws"
    ],
    "lastSeen": ${TIMESTAMP},
    "latency": 0,
    "reliability": 0.95
  }
]
EOF

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║         DNS TXT Record Generator                       ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

echo "📋 Peers configurados:"
echo "  1. ${PEER1_ID:0:20}... (bootstrap1)"
echo "  2. ${PEER2_ID:0:20}... (bootstrap2)"
echo "  3. ${PEER3_ID:0:20}... (bootstrap3)"
echo ""

# Codificar em base64
BASE64_ENCODED=$(echo "$PEERS_JSON" | base64 | tr -d '\n')

# Versão truncada para mostrar
BASE64_SHORT="${BASE64_ENCODED:0:50}..."

echo "🔐 TXT Record Value:"
echo ""
echo "peers=${BASE64_SHORT}"
echo ""
echo "  (valor completo: ${#BASE64_ENCODED} caracteres)"
echo ""

# Salvar em arquivo
OUTPUT_FILE="dns-txt-record-${TIMESTAMP}.txt"
echo "peers=${BASE64_ENCODED}" > "$OUTPUT_FILE"

echo "💾 Valor completo salvo em: ${OUTPUT_FILE}"
echo ""

echo "📡 Configuração DNS necessária (Cloudflare/Route53):"
echo ""
echo "  Type:  TXT"
echo "  Name:  bootstrap"
echo "  Value: peers=${BASE64_SHORT}"
echo "  TTL:   300 (ou Auto)"
echo ""

echo "🌐 A Records necessários:"
echo ""
echo "  Type: A"
echo "  Name: bootstrap1"
echo "  Value: <IP_DO_VPS_1>"
echo ""
echo "  Type: A"
echo "  Name: bootstrap2"
echo "  Value: <IP_DO_VPS_2>"
echo ""
echo "  Type: A"
echo "  Name: bootstrap3"
echo "  Value: <IP_DO_VPS_3>"
echo ""

echo "✨ Próximos passos:"
echo "  1. Copie o valor de ${OUTPUT_FILE}"
echo "  2. Cole no registro TXT de bootstrap.society.computer"
echo "  3. Configure os 3 A records apontando para seus VPS"
echo "  4. Aguarde propagação DNS (pode levar até 5 minutos)"
echo "  5. Teste com: dig +short TXT bootstrap.society.computer"
echo ""
