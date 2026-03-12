---
title: "Guia: Rede Hospitalar RarasNet"
description: Como conectar hospitais reais na rede RarasNet para colaborar no diagnóstico de doenças raras
---

Guia passo a passo para conectar seu hospital à rede **RarasNet** — uma rede de colaboração médica onde hospitais compartilham casos, trocam insights diagnósticos e constroem uma base de conhecimento coletiva sobre doenças raras.

## O que é a RarasNet?

A RarasNet é uma federação de hospitais que se conectam diretamente entre si, sem depender de um servidor central. Cada hospital tem sua própria identidade digital e pode:

- Compartilhar casos clínicos com a rede
- Receber opiniões de especialistas de outros hospitais
- Consultar uma base de conhecimento coletiva
- Usar IA local para auxiliar no diagnóstico

```
Hospital São Paulo  ──┐
Hospital Rio        ───┤── Internet ── Painel de Monitoramento
Hospital Brasília   ───┘
Hospital B. Aires   ──┘
```

## O que você precisa

- Um computador com acesso à internet (pode ser o servidor que o hospital já tem)
- O endereço da rede RarasNet (fornecido pelo coordenador da federação)
- Cerca de 15 minutos para configurar

## Passo 1: Instalar o Society

Abra o terminal do computador e execute:

```bash
npm install -g society-protocol
```

> Se o comando `npm` não for reconhecido, peça ao TI do hospital para instalar o Node.js primeiro: https://nodejs.org

Para verificar que funcionou:

```bash
society --version
```

## Passo 2: Conectar seu hospital à rede

Execute o comando abaixo, substituindo o nome do seu hospital:

```bash
society join \
  --name "Hospital São Paulo" \
  --room rarasnet \
  --relay wss://relay.rarasnet.org
```

Pronto. Seu hospital já está na rede. Você verá algo como:

```
✓ Hospital São Paulo conectado à RarasNet
  Identidade: did:key:z6MkpT...
  Sala: rarasnet
  Hospitais online: 12
```

> A identidade (`did:key:...`) é única do seu hospital. Ela é criada automaticamente na primeira conexão e reutilizada nas próximas.

### Opções do comando `join`

| Opção | O que faz | Exemplo |
|-------|-----------|---------|
| `--name` | Nome do hospital na rede | `"HC FMUSP"` |
| `--room` | Sala para entrar | `rarasnet` |
| `--relay` | Endereço do servidor de conexão | `wss://relay.rarasnet.org` |
| `--db` | Onde guardar os dados (opcional) | `./meus-dados.db` |

## Passo 3: Ver quem está online

```bash
society peers --room rarasnet
```

Resultado:

```
Sala: rarasnet (15 hospitais online)

  HC FMUSP              São Paulo       conectado há 2 min
  Hospital Fiocruz      Rio de Janeiro  conectado há 5 min
  Hospital de Clínicas  Porto Alegre    conectado há 12 min
  Hospital Italiano     Buenos Aires    conectado há 1 hora
  ...
```

## Passo 4: Enviar um caso para discussão

Para compartilhar um caso clínico com a rede:

```bash
society send --room rarasnet --text "Caso: Paciente 34a, masculino. Febre persistente, hepatoesplenomegalia, pancitopenia. Viagem recente a área endêmica. Sem resposta a antibióticos."
```

Todos os hospitais conectados à sala `rarasnet` receberão a mensagem.

### Enviar com mais detalhes

```bash
society send --room rarasnet --text "
CASO RN-2026-0042
Paciente: 34 anos, masculino
Sintomas: febre persistente, hepatoesplenomegalia, pancitopenia, perda de peso
Histórico: viagem recente a área endêmica de leishmaniose
Exames: hemograma com pancitopenia, sorologias negativas para HIV e hepatite
Hipótese: leishmaniose visceral?
Solicita: opinião de infectologista e hematologista
"
```

## Passo 5: Receber mensagens de outros hospitais

Em um terminal separado, ative o modo de escuta:

```bash
society listen --room rarasnet
```

Você verá as mensagens de todos os hospitais em tempo real:

```
[Hospital Fiocruz] Concordo com a hipótese de leishmaniose visceral. Sugerimos aspirado de medula óssea para pesquisa de amastigotas.

[HC Porto Alegre] Considerar também calazar. Temos experiência com anfotericina B lipossomal. Dose: 3mg/kg/dia por 5 dias.

[Hospital Italiano BA] Padrão similar a caso que tivemos em 2024. Encaminhando knowledge card com protocolo.
```

## Passo 6: Consultar a base de conhecimento

A rede mantém uma base de conhecimento coletiva. Para buscar:

```bash
# Buscar por tema
society knowledge search --query "leishmaniose"

# Buscar por tags
society knowledge search --tags "pancitopenia,febre"
```

Resultado:

```
3 resultados encontrados:

1. "Leishmaniose Visceral — Apresentação Atípica"
   Hospital: HC FMUSP | Confiança: 92%
   Tags: leishmaniose, tropical, pancitopenia

2. "Protocolo de Tratamento LV — Anfotericina B"
   Hospital: Hospital Fiocruz | Confiança: 95%
   Tags: leishmaniose, tratamento, protocolo

3. "Diagnóstico Diferencial de Pancitopenia Febril"
   Hospital: HC Porto Alegre | Confiança: 88%
   Tags: pancitopenia, febre, diagnóstico-diferencial
```

Para ver o conteúdo completo de um resultado:

```bash
society knowledge view --id "resultado-1-id"
```

## Passo 7: Compartilhar um conhecimento

Quando seu hospital descobrir algo relevante, compartilhe com a rede:

```bash
society knowledge add \
  --title "Leishmaniose Visceral — Apresentação Atípica" \
  --text "Paciente sem febre típica, apenas pancitopenia e hepatoesplenomegalia. Aspirado de medula confirmou amastigotas. Importante: considerar LV mesmo sem apresentação clássica em viajantes de áreas endêmicas." \
  --tags "leishmaniose,tropical,pancitopenia" \
  --confidence 0.92
```

O conhecimento será sincronizado automaticamente com todos os hospitais da rede.

## Passo 8: Ativar IA local (opcional)

Se o hospital quiser usar inteligência artificial para auxiliar no diagnóstico, instale o Ollama:

```bash
# Instalar
curl -fsSL https://ollama.com/install.sh | sh

# Baixar modelo médico
ollama pull qwen3:8b
```

Depois, ative a IA no agente:

```bash
society join \
  --name "Hospital São Paulo" \
  --room rarasnet \
  --relay wss://relay.rarasnet.org \
  --ai ollama \
  --model qwen3:8b
```

Agora, ao receber um caso, o agente do hospital automaticamente gera uma análise inicial usando a IA local:

```
[IA Local] Análise do caso RN-2026-0042:
Diagnóstico diferencial:
1. Leishmaniose visceral (calazar) — mais provável dado o quadro clínico
2. Linfoma — considerar se aspirado de medula negativo
3. Síndrome hemofagocítica — solicitar ferritina e triglicerídeos
Próximos passos recomendados: aspirado de medula óssea, sorologia rK39
```

> A IA roda localmente no computador do hospital. Nenhum dado de paciente sai da instituição.

## Passo 9: Criar uma federação entre redes

Se você coordena múltiplas redes (ex: rede do Nordeste + rede do Sudeste), pode conectá-las via federação:

```bash
# Criar federação
society federation create \
  --name "RarasNet Brasil" \
  --description "Rede nacional de doenças raras"

# Convidar outra rede para a federação
society federation invite \
  --federation "RarasNet Brasil" \
  --peer "RarasNet Nordeste"

# Aceitar convite (no lado da outra rede)
society federation accept --invite-id "abc123"

# Abrir ponte entre salas
society federation bridge \
  --from rarasnet-sudeste \
  --to rarasnet-nordeste
```

Agora as duas redes compartilham casos e conhecimento automaticamente.

## Passo 10: Manter o agente sempre ligado

Para que seu hospital fique sempre disponível na rede, configure para iniciar automaticamente:

### Linux (a maioria dos servidores)

```bash
# Criar serviço
sudo nano /etc/systemd/system/rarasnet.service
```

Cole este conteúdo:

```ini
[Unit]
Description=RarasNet Hospital Agent
After=network.target

[Service]
ExecStart=/usr/bin/society join --name "Hospital São Paulo" --room rarasnet --relay wss://relay.rarasnet.org --db /var/lib/rarasnet/hospital.db
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Ative:

```bash
sudo systemctl enable --now rarasnet
```

Agora o agente inicia sozinho quando o servidor liga e reinicia se cair.

### Verificar se está rodando

```bash
sudo systemctl status rarasnet
```

## Passo 11: Acessar o painel visual (opcional)

O coordenador da federação pode disponibilizar um painel web onde todos veem:

- Mapa com os hospitais conectados
- Mensagens e casos em tempo real
- Base de conhecimento
- Estatísticas da rede

Acesse o endereço fornecido pelo coordenador (ex: `https://painel.rarasnet.org`).

## Perguntas Frequentes

### Os dados dos pacientes ficam seguros?

Sim. Cada hospital controla o que compartilha. A identidade do paciente nunca é enviada automaticamente — apenas as informações clínicas que o médico decidir compartilhar. A IA roda localmente, sem enviar dados para nuvem.

### Preciso de TI para configurar?

A instalação inicial precisa de alguém com acesso ao terminal do servidor. Depois, o uso diário (enviar casos, consultar base) pode ser feito por qualquer pessoa com os comandos básicos.

### E se a internet cair?

O agente reconecta automaticamente quando a internet voltar. Mensagens enviadas enquanto você estava offline serão recebidas na reconexão.

### Quantos hospitais podem participar?

Não há limite prático. A rede foi testada com 20+ hospitais simultâneos. Para redes maiores (100+), o coordenador pode configurar federações regionais.

### Posso participar de várias salas?

Sim. Além da sala principal (`rarasnet`), você pode entrar em salas especializadas:

```bash
society join --room rarasnet-oncologia
society join --room rarasnet-genetica
society join --room rarasnet-infectologia
```

### Como atualizo o software?

```bash
npm update -g society-protocol
sudo systemctl restart rarasnet
```

## Resumo dos Comandos

| O que fazer | Comando |
|-------------|---------|
| Conectar à rede | `society join --name "Meu Hospital" --room rarasnet --relay wss://relay.rarasnet.org` |
| Ver hospitais online | `society peers --room rarasnet` |
| Enviar mensagem | `society send --room rarasnet --text "mensagem"` |
| Ouvir mensagens | `society listen --room rarasnet` |
| Buscar conhecimento | `society knowledge search --query "tema"` |
| Compartilhar conhecimento | `society knowledge add --title "Título" --text "Conteúdo" --tags "tag1,tag2"` |
| Verificar status | `sudo systemctl status rarasnet` |

## Precisa de ajuda?

Entre em contato com o coordenador da RarasNet ou abra um chamado em:
https://github.com/prtknr/society/issues
