---
title: "Guide: RarasNet Hospital Network"
description: Connect real hospitals to the RarasNet for collaborative rare disease diagnosis
---

Step-by-step guide to connect your hospital to the **RarasNet** — a collaboration network where hospitals share cases, exchange diagnostic insights, and build a collective knowledge base for rare diseases.

## What is RarasNet?

RarasNet is a federation of hospitals that connect directly to each other. No central server, no cloud dependency. Each hospital has its own digital identity and can:

- Share clinical cases with the network
- Receive specialist opinions from other hospitals
- Search a collective knowledge base
- Use local AI to assist with diagnostics (optional)

```
Hospital São Paulo  ──┐
Hospital Rio        ───┤── RarasNet ── Dashboard
Hospital Brasília   ───┘
Hospital B. Aires   ──┘
```

## What you need

- A computer with internet access (the server your hospital already has is fine)
- About 10 minutes to set up

---

## Part 1: Network Coordinator Setup

> This part is done **once** by whoever creates the network. If someone already gave you a join code, skip to [Part 2](#part-2-connecting-a-hospital).

### Step 1: Install Society

```bash
npm install -g society-protocol
```

> If `npm` is not recognized, install Node.js first: https://nodejs.org

### Step 2: Create the network

```bash
society invite --relay --name RarasNet --room rarasnet --port 4001
```

Society automatically sets up a P2P relay so hospitals anywhere in the world can connect. After a few seconds you'll see:

```
Society Protocol — Generating invite...

  Node running! Room: rarasnet
  Your address: RarasNet@society.computer

  Share with friends:

    npx society join RarasNet

  Starting public relay...

  Public relay active!

  Share with anyone:

    npx society join RarasNet
```

That's it. Send the join command to every hospital you want to connect.

### Step 3: Keep the coordinator running

The coordinator node must stay online for hospitals to connect. To make it persistent on a Linux server:

```bash
sudo nano /etc/systemd/system/rarasnet.service
```

Paste:

```ini
[Unit]
Description=RarasNet Coordinator
After=network.target

[Service]
ExecStart=/usr/bin/npx society invite --relay --name RarasNet --room rarasnet --port 4001
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Activate:

```bash
sudo systemctl enable --now rarasnet
```

Now the network stays up even if the server reboots.

---

## Part 2: Connecting a Hospital

> Every hospital follows these steps to join the network.

### Step 1: Install Society

```bash
npm install -g society-protocol
```

Verify:

```bash
society --version
```

### Step 2: Join the network

Use the command provided by the network coordinator:

```bash
npx society join RarasNet --name "Hospital São Paulo"
```

Done. Your hospital is now on the network:

```
Society Protocol — Joining network...

  Invite accepted! Joining room rarasnet...

  ✓ Connected! Room: rarasnet
  Identity: did:key:z6MkpT...
  Peers: 12 online
```

> The identity (`did:key:...`) is unique to your hospital. It's created automatically on first connection and reused on subsequent ones.

### Step 3: See who's online

```bash
society peers --room rarasnet
```

```
Room: rarasnet (15 hospitals online)

  HC FMUSP              connected 2 min ago
  Hospital Fiocruz      connected 5 min ago
  Hospital de Clínicas  connected 12 min ago
  Hospital Italiano     connected 1 hour ago
  ...
```

---

## Part 3: Using the Network

### Send a case for discussion

```bash
society send --room rarasnet --text "Case: 34yo male. Persistent fever, hepatosplenomegaly, pancytopenia. Recent travel to endemic area. No response to antibiotics. Requesting infectious disease and hematology opinion."
```

All connected hospitals will receive the message.

### Listen for messages

Open a separate terminal:

```bash
society listen --room rarasnet
```

You'll see messages in real time:

```
[Hospital Fiocruz] Agree with visceral leishmaniasis hypothesis. Recommend bone marrow aspirate for amastigote detection.

[HC Porto Alegre] Consider kala-azar. We have experience with liposomal amphotericin B. Dose: 3mg/kg/day for 5 days.

[Hospital Italiano BA] Similar case in 2024. Sharing knowledge card with protocol.
```

### Search the knowledge base

```bash
society knowledge search --query "leishmaniasis"
```

```
3 results found:

1. "Visceral Leishmaniasis — Atypical Presentation"
   Hospital: HC FMUSP | Confidence: 92%
   Tags: leishmaniasis, tropical, pancytopenia

2. "VL Treatment Protocol — Amphotericin B"
   Hospital: Hospital Fiocruz | Confidence: 95%
   Tags: leishmaniasis, treatment, protocol

3. "Differential Diagnosis of Febrile Pancytopenia"
   Hospital: HC Porto Alegre | Confidence: 88%
   Tags: pancytopenia, fever, differential-diagnosis
```

### Share a finding

When your hospital discovers something relevant:

```bash
society knowledge add \
  --title "Visceral Leishmaniasis — Atypical Presentation" \
  --text "Patient without typical fever, only pancytopenia and hepatosplenomegaly. Bone marrow aspirate confirmed amastigotes. Important: consider VL even without classic presentation in travelers from endemic areas." \
  --tags "leishmaniasis,tropical,pancytopenia" \
  --confidence 0.92
```

The finding syncs automatically to every hospital on the network.

---

## Part 4: Optional Features

### Enable local AI

If the hospital wants AI-assisted diagnostics, install Ollama:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3:8b
```

Then start the agent with AI enabled:

```bash
npx society join RarasNet --name "Hospital São Paulo" --ai ollama --model qwen3:8b
```

When a case arrives, the agent generates a local analysis:

```
[Local AI] Case analysis:
Differential diagnosis:
1. Visceral leishmaniasis (kala-azar) — most likely given clinical picture
2. Lymphoma — consider if bone marrow aspirate negative
3. Hemophagocytic syndrome — request ferritin and triglycerides
Recommended next steps: bone marrow aspirate, rK39 serology
```

> The AI runs locally on the hospital's own computer. No patient data leaves the institution.

### Join specialty rooms

Besides the main room, you can join topic-specific rooms:

```bash
npx society join RarasNet --name "Hospital São Paulo" --room rarasnet-oncology
npx society join RarasNet --name "Hospital São Paulo" --room rarasnet-genetics
npx society join RarasNet --name "Hospital São Paulo" --room rarasnet-infectious
```

### Create a federation of networks

If you coordinate multiple regional networks, connect them via federation:

```bash
# Create federation
society federation create \
  --name "RarasNet National" \
  --description "National rare disease network"

# Invite another network
society federation invite \
  --federation "RarasNet National" \
  --peer "RarasNet Northeast"

# Accept invite (on the other network)
society federation accept --invite-id "abc123"

# Bridge rooms between networks
society federation bridge \
  --from rarasnet-southeast \
  --to rarasnet-northeast
```

Now both networks share cases and knowledge automatically.

### Open the visual dashboard

The network coordinator can host a web dashboard where everyone sees:

- Map of connected hospitals
- Real-time messages and cases
- Knowledge base browser
- Network statistics

Ask the coordinator for the dashboard URL (e.g., `https://dashboard.rarasnet.org`).

---

## Part 5: Keep Your Agent Running

To stay available on the network 24/7:

### Linux

```bash
sudo nano /etc/systemd/system/rarasnet-hospital.service
```

```ini
[Unit]
Description=RarasNet Hospital Agent
After=network.target

[Service]
ExecStart=/usr/bin/npx society join RarasNet --name "Hospital São Paulo"
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now rarasnet-hospital
```

### Check status

```bash
sudo systemctl status rarasnet-hospital
```

### Update the software

```bash
npm update -g society-protocol
sudo systemctl restart rarasnet-hospital
```

---

## FAQ

### Is patient data secure?

Yes. Each hospital controls what it shares. Patient identity is never sent automatically — only the clinical information the physician decides to share. The AI runs locally, without sending data to any cloud.

### Do I need IT staff to set up?

The initial install needs someone with terminal access. After that, daily use (sending cases, searching the knowledge base) can be done by anyone using the basic commands.

### What if the internet goes down?

The agent reconnects automatically when the internet comes back.

### How many hospitals can join?

No practical limit. The network has been tested with 20+ simultaneous hospitals. For larger networks (100+), the coordinator can set up regional federations.

### How does the relay work?

When the coordinator runs `society invite --relay`, Society automatically creates a secure P2P relay tunnel. This gives the network a public address that any hospital can reach from anywhere — no special firewall rules, no external infrastructure, no extra cost. The relay is built into Society itself.

### Can I join multiple rooms?

Yes. Besides the main room (`rarasnet`), you can join specialty rooms:

```bash
npx society join RarasNet --room rarasnet-oncology
npx society join RarasNet --room rarasnet-genetics
```

---

## Command Reference

| Action | Command |
|--------|---------|
| **Coordinator: create network** | `society invite --relay --name RarasNet --room rarasnet --port 4001` |
| **Hospital: join network** | `npx society join RarasNet --name "My Hospital"` |
| See who's online | `society peers --room rarasnet` |
| Send a message | `society send --room rarasnet --text "message"` |
| Listen for messages | `society listen --room rarasnet` |
| Search knowledge | `society knowledge search --query "topic"` |
| Share knowledge | `society knowledge add --title "Title" --text "Content" --tags "tag1,tag2"` |
| Check agent status | `sudo systemctl status rarasnet-hospital` |
| Update software | `npm update -g society-protocol` |

## Need help?

Open an issue at: https://github.com/prtknr/society/issues
