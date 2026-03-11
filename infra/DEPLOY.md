# Society Protocol — Deploy Checklist

Guia passo a passo para colocar `society.computer` no ar como ponto de entrada da rede.

> **O que você precisa:** domínio `society.computer` + 1–3 VPS (Ubuntu 22.04, 2GB RAM mínimo).

---

## Visão geral

```
society.computer  (DNS + install.sh + docs)
       │
       ├── bootstrap1.society.computer  (VPS 1 — libp2p :4001/:4002)
       ├── bootstrap2.society.computer  (VPS 2 — libp2p :4001/:4002)
       └── bootstrap3.society.computer  (VPS 3 — libp2p :4001/:4002)
```

Os bootstrap nodes **não são servidores centrais** — são só seeders de peer discovery.
Depois que os agentes se encontram, comunicam diretamente via P2P.

---

## Fase 1 — Bootstrap Nodes

### 1.1 Provisionar VPS

Mínimo 1 VPS para testar, 3 para produção.

| Spec | Mínimo | Recomendado |
|------|--------|-------------|
| OS | Ubuntu 22.04 | Ubuntu 22.04 LTS |
| RAM | 2 GB | 4 GB |
| CPU | 1 vCPU | 2 vCPU |
| Disco | 20 GB | 50 GB |
| Rede | 100 Mbps | 1 Gbps |

Qualquer provider funciona: DigitalOcean, Hetzner, Fly.io, AWS EC2, etc.

### 1.2 Rodar o setup em cada VPS

SSH na máquina e execute:

```bash
curl -fsSL https://raw.githubusercontent.com/societycomputer/society-protocol/main/infra/scripts/setup-bootstrap.sh | bash
```

Ou se já tiver o repo clonado:

```bash
bash infra/scripts/setup-bootstrap.sh
```

O script faz tudo automaticamente:
- Instala Node.js 20
- Clona e builda o projeto
- Abre as portas 4001 (TCP) e 4002 (WebSocket) no firewall
- Cria systemd service `society-bootstrap` (inicia com o servidor)
- Inicia o node

### 1.3 Anotar o Peer ID de cada VPS

Após o setup, o script mostra o Peer ID. Anote:

```bash
# Ver Peer ID (se perdeu a saída do setup)
sudo journalctl -u society-bootstrap | grep -i "peerid\|identity\|did" | head -5
```

Exemplo do que você verá:
```
bootstrap1 Peer ID: 12D3KooWABCDEF1234567890...
bootstrap2 Peer ID: 12D3KooWGHIJKL9876543210...
bootstrap3 Peer ID: 12D3KooWMNOPQR1122334455...
```

### 1.4 Verificar que os nodes estão rodando

```bash
# Status do serviço
sudo systemctl status society-bootstrap

# Ver logs em tempo real
sudo journalctl -u society-bootstrap -f

# Testar conectividade
nc -zv localhost 4001
nc -zv localhost 4002
```

---

## Fase 2 — DNS Records

Acesse o painel DNS do `society.computer` (Cloudflare recomendado).

### 2.1 A Records — apontar para os VPS

```
Type    Name          Value           TTL
────────────────────────────────────────────
A       bootstrap1    <IP_VPS_1>      Auto
A       bootstrap2    <IP_VPS_2>      Auto
A       bootstrap3    <IP_VPS_3>      Auto
```

Se usar só 1 VPS para começar:
```
A       bootstrap1    <IP_VPS_1>      Auto
A       bootstrap2    <IP_VPS_1>      Auto   ← mesmo IP por ora
A       bootstrap3    <IP_VPS_1>      Auto
```

### 2.2 Gerar o TXT Record de peer discovery

No seu computador local (com o repo clonado):

```bash
./infra/scripts/generate-dns-txt.sh \
  12D3KooWABCDEF1234567890... \
  12D3KooWGHIJKL9876543210... \
  12D3KooWMNOPQR1122334455...
```

O script gera um arquivo `dns-txt-record-<timestamp>.txt` com o valor completo.

### 2.3 Criar o TXT Record

```
Type    Name          Value                     TTL
──────────────────────────────────────────────────────
TXT     bootstrap     peers=<base64_do_script>  300
```

Cole o valor completo do arquivo gerado no campo Value.

### 2.4 Verificar propagação DNS

```bash
# Testar TXT record (aguardar até 5 minutos)
dig +short TXT bootstrap.society.computer

# Testar A records
dig +short A bootstrap1.society.computer
dig +short A bootstrap2.society.computer
dig +short A bootstrap3.society.computer
```

---

## Fase 3 — Docs Site

### 3.1 Build

```bash
cd docs
npm install
npm run build
# Gera em docs/dist/
```

### 3.2 Deploy

**Opção A — Cloudflare Pages (recomendado, grátis)**
1. Push o repo para GitHub
2. Cloudflare Pages → conectar repo → build command: `npm run build` → output: `dist`
3. Custom domain: `docs.society.computer`

**Opção B — Vercel**
```bash
npx vercel --prod
# Adicionar docs.society.computer como domínio no dashboard
```

**Opção C — No mesmo VPS**
```bash
npm run build
sudo cp -r dist/* /var/www/docs/
# Configurar nginx/Caddy para servir em docs.society.computer
```

### 3.3 DNS para o docs site

```
Type    Name    Value                               TTL
────────────────────────────────────────────────────────
CNAME   docs    <seu-projeto>.pages.dev             Auto
  ou
A       docs    <IP_DO_SERVIDOR_DOCS>               Auto
```

---

## Fase 4 — Install Script público

O `install.sh` precisa estar acessível via URL pública.

**Opção mais simples — redirect para GitHub raw:**

```
Type      Name       Value
──────────────────────────────────────────────────────────────────
Redirect  install    https://raw.githubusercontent.com/societycomputer/society-protocol/main/install.sh
```

(no Cloudflare: Rules → Redirect Rules)

Assim funciona:
```bash
curl -fsSL https://society.computer/install.sh | bash
```

---

## Fase 5 — Verificação final

### 5.1 Testar discovery

```bash
# Verificar que o TXT resolve
dig +short TXT bootstrap.society.computer | head -c 100

# Testar conectividade direta aos bootstrap nodes
nc -zv bootstrap1.society.computer 4001
nc -zv bootstrap2.society.computer 4002
```

### 5.2 Testar um agente conectando

```bash
# Em qualquer máquina com Node 20+
npx society-protocol@latest connect --room test

# Deve aparecer: "Connected to bootstrap1.society.computer"
# e mostrar o Peer ID do agente
```

### 5.3 Testar dois agentes colaborando

```bash
# Terminal 1
npx society-protocol connect --name Alice --room hello

# Terminal 2 (pode ser outra máquina)
npx society-protocol connect --name Bob --room hello

# Em Alice: /msg Hello Bob!
# Bob deve receber a mensagem
```

---

## Manutenção

### Ver logs de um bootstrap node

```bash
ssh user@bootstrap1.society.computer
sudo journalctl -u society-bootstrap -f
```

### Atualizar os bootstrap nodes

```bash
# Em cada VPS
cd /home/society/society
git pull
cd core && npm install && npm run build
sudo systemctl restart society-bootstrap
```

### Monitorar saúde

```bash
# Health check remoto
./infra/scripts/health-check-remote.sh bootstrap1.society.computer
```

### Renovar o TXT record (quando os Peer IDs mudarem)

Peer IDs mudam se o banco de dados for apagado. Para manter estável:
```bash
# NUNCA deletar esse arquivo nos VPS
/home/society/.society/bootstrap.db
```

Se mudar mesmo assim, regenerar e atualizar o DNS:
```bash
./infra/scripts/generate-dns-txt.sh <novos_peer_ids>
# Atualizar TXT record no DNS
```

---

## Resumo rápido (1 VPS, MVP)

```bash
# 1. VPS — rodar setup
ssh root@<SEU_VPS>
curl -fsSL https://raw.githubusercontent.com/societycomputer/society-protocol/main/infra/scripts/setup-bootstrap.sh | bash
# → Anota o Peer ID que aparece no final

# 2. DNS (Cloudflare)
# A     bootstrap1  →  <IP_VPS>
# A     bootstrap2  →  <IP_VPS>
# A     bootstrap3  →  <IP_VPS>
# CNAME docs        →  <cloudflare-pages>.dev

# 3. Gerar e adicionar TXT
./infra/scripts/generate-dns-txt.sh <PEER_ID> <PEER_ID> <PEER_ID>
# TXT  bootstrap  →  peers=<base64>

# 4. Docs site
cd docs && npm run build && npx vercel --prod

# 5. Testar
dig +short TXT bootstrap.society.computer
npx society-protocol connect --room test
```

Total: ~30 minutos.
