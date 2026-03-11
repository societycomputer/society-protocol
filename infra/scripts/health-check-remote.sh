#!/bin/bash
#
# Health check remoto para Society bootstrap nodes
# Uso: ./health-check-remote.sh
#

set -e

BOOTSTRAPS=(
    "bootstrap1.society.computer:4001"
    "bootstrap2.society.computer:4001"
    "bootstrap3.society.computer:4001"
)

DNS_ENDPOINT="bootstrap.society.computer"

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║     Society Protocol - Health Check                    ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

passed=0
failed=0

# Testar DNS
echo "📡 Testando DNS..."
echo ""

TXT_RECORD=$(dig +short TXT "${DNS_ENDPOINT}" 2>/dev/null || echo "")
if [ -n "$TXT_RECORD" ]; then
    echo -e "  ${GREEN}✅${NC} TXT record encontrado: ${TXT_RECORD:0:50}..."
    ((passed++))
else
    echo -e "  ${RED}❌${NC} TXT record não encontrado"
    ((failed++))
fi

# Verificar A records
echo ""
echo "🌐 Testando A records..."
echo ""

for i in 1 2 3; do
    HOST="bootstrap${i}.society.computer"
    IP=$(dig +short A "$HOST" 2>/dev/null || echo "")
    
    if [ -n "$IP" ]; then
        echo -e "  ${GREEN}✅${NC} ${HOST} → ${IP}"
        ((passed++))
    else
        echo -e "  ${RED}❌${NC} ${HOST} - não resolvido"
        ((failed++))
    fi
done

# Testar conectividade TCP
echo ""
echo "🔗 Testando conectividade TCP..."
echo ""

for endpoint in "${BOOTSTRAPS[@]}"; do
    host=$(echo "$endpoint" | cut -d: -f1)
    port=$(echo "$endpoint" | cut -d: -f2)
    
    echo -n "  Testando ${host}:${port} ... "
    
    if timeout 5 bash -c "</dev/tcp/${host}/${port}" 2>/dev/null; then
        echo -e "${GREEN}✅ OK${NC}"
        ((passed++))
    else
        echo -e "${RED}❌ FAIL${NC}"
        ((failed++))
    fi
done

# Testar latência
echo ""
echo "⏱️  Testando latência (ping)..."
echo ""

for endpoint in "${BOOTSTRAPS[@]}"; do
    host=$(echo "$endpoint" | cut -d: -f1)
    
    echo -n "  ${host} ... "
    
    # Extrair IP se for hostname
    ip=$(dig +short A "$host" 2>/dev/null | head -1)
    
    if [ -n "$ip" ]; then
        # Tentar ping
        if ping -c 1 -W 2 "$ip" > /dev/null 2>&1; then
            latency=$(ping -c 1 -W 2 "$ip" | grep 'time=' | sed -n 's/.*time=\([0-9.]*\) ms.*/\1/p')
            echo -e "${GREEN}✅${NC} ${latency}ms"
            ((passed++))
        else
            echo -e "${YELLOW}⚠️${NC}  Ping bloqueado (pode ser normal)"
            ((passed++))  # Não conta como falha
        fi
    else
        echo -e "${RED}❌${NC} Não resolvido"
        ((failed++))
    fi
done

# Resumo
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║                    Resumo                              ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo -e "  ${GREEN}Passaram:${NC} ${passed}"
echo -e "  ${RED}Falharam:${NC} ${failed}"
echo ""

if [ $failed -eq 0 ]; then
    echo -e "${GREEN}✅ Todos os checks passaram!${NC}"
    echo ""
    echo "🚀 Você pode testar localmente com:"
    echo "   society node --name test --room test"
    exit 0
else
    echo -e "${YELLOW}⚠️  Alguns checks falharam.${NC}"
    echo ""
    echo "🔧 Verifique:"
    echo "   1. Se os VPS estão rodando: ssh user@bootstrap1.society.computer 'sudo systemctl status society-bootstrap'"
    echo "   2. Se o firewall permite porta 4001"
    echo "   3. Se o DNS propagated: dig +short TXT bootstrap.society.computer"
    exit 1
fi
