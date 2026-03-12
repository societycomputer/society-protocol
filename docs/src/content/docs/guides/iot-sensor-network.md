---
title: "Tutorial: IoT Sensor Network"
description: Deploy a decentralized P2P network of IoT sensor agents for agriculture, environmental, or industrial monitoring
---

Deploy a decentralized network of IoT sensor agents that collect, analyze, and share environmental data via P2P. Each sensor node is an autonomous agent with its own identity, capable of peer-to-peer coordination without a central server.

## Use Cases

| Domain | Sensors | Metrics |
|--------|---------|---------|
| **Agriculture** | Soil moisture, temperature, pH, humidity, rainfall | Crop health, irrigation timing |
| **Environment** | Air quality, water level, noise, UV | Pollution alerts, flood warning |
| **Industrial** | Vibration, power, thermal, pressure | Predictive maintenance, anomaly detection |

## Architecture Overview

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Sensor 1  │  │ Sensor 2  │  │ Sensor 3  │  │ Sensor N  │
│ moisture  │  │ temp      │  │ pH        │  │ humidity  │
└─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
      │              │              │              │
      └──────── P2P GossipSub Mesh ───────────────┘
                         │
                  ┌──────▼───────┐
                  │ Coordinator  │
                  │ AI Analysis  │
                  │ Alert Engine │
                  └──────────────┘
```

All nodes communicate peer-to-peer. No central server required. If the coordinator goes offline, sensors continue collecting and broadcasting.

## Prerequisites

- Node.js 20+ on each sensor node (Raspberry Pi, Intel NUC, or any Linux device)
- Ollama on the coordinator node (optional, for AI analysis)
- Network connectivity between nodes (LAN or internet via relay)

## Step 1: Prepare Sensor Hardware

### Raspberry Pi Setup

```bash
# Install Node.js 20 on Raspberry Pi OS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# Install Society
npm install -g society-protocol

# Create project directory
mkdir -p /opt/sensor-agent && cd /opt/sensor-agent
npm init -y
npm install society-protocol
```

### Supported Hardware

| Device | RAM | Notes |
|--------|-----|-------|
| Raspberry Pi 4/5 | 2-8 GB | Recommended for most sensors |
| Raspberry Pi Zero 2 W | 512 MB | Use `Light` mode, no Ollama |
| Intel NUC | 8+ GB | Good for coordinator + Ollama |
| Any Linux SBC | 1+ GB | ARM64 or x86_64 |

## Step 2: Create the Sensor Agent

Create `/opt/sensor-agent/sensor.js`:

```javascript
import { createClient } from 'society-protocol';

// ─── Configuration (from environment) ───────────────────────────

const SENSOR_NAME = process.env.SENSOR_NAME || 'sensor-1';
const SENSOR_TYPE = process.env.SENSOR_TYPE || 'temperature';
const SENSOR_UNIT = process.env.SENSOR_UNIT || '°C';
const NETWORK_ROOM = process.env.NETWORK_ROOM || 'farm-sensors';
const READ_INTERVAL = parseInt(process.env.READ_INTERVAL || '10000', 10);
const RELAY_ADDR = process.env.RELAY_ADDR || '';
const DB_PATH = process.env.DB_PATH || `/opt/sensor-agent/data/${SENSOR_NAME}.db`;

// Alert thresholds
const ALERT_HIGH = parseFloat(process.env.ALERT_HIGH || 'Infinity');
const ALERT_LOW = parseFloat(process.env.ALERT_LOW || '-Infinity');

// ─── Sensor Reading ─────────────────────────────────────────────

function readSensor() {
  // Replace with real hardware reading
  // Examples:
  //   - GPIO via onoff/pigpio library
  //   - I2C via i2c-bus library (BME280, ADS1115)
  //   - Serial via serialport library
  //   - USB via node-hid
  //
  // For demo: simulate a reading
  const base = SENSOR_TYPE === 'temperature' ? 25 :
               SENSOR_TYPE === 'soil-moisture' ? 55 :
               SENSOR_TYPE === 'soil-ph' ? 6.5 : 50;
  const noise = (Math.random() - 0.5) * 5;
  return Math.round((base + noise) * 100) / 100;
}

// ─── Real Hardware Examples ─────────────────────────────────────

// BME280 temperature/humidity (I2C):
// import BME280 from 'bme280-sensor';
// const bme = new BME280({ i2cBusNo: 1, i2cAddress: 0x76 });
// await bme.init();
// const { temperature, humidity } = await bme.readSensorData();

// Soil moisture (ADC via ADS1115):
// import Ads1115 from 'ads1115';
// const ads = await Ads1115.open(1, 0x48);
// const raw = await ads.measure('0+GND');
// const moisture = mapRange(raw, 0, 26000, 100, 0); // Calibrated

// ─── Main Agent ─────────────────────────────────────────────────

async function main() {
  console.log(`Starting ${SENSOR_NAME} (${SENSOR_TYPE})...`);

  const agent = await createClient({
    identity: { name: SENSOR_NAME },
    storage: { path: DB_PATH },
    network: {
      listenAddrs: ['/ip4/0.0.0.0/tcp/0'],
      bootstrapPeers: RELAY_ADDR ? [RELAY_ADDR] : [],
      enableGossipsub: true,
      enableMdns: !RELAY_ADDR,  // mDNS for LAN, relay for WAN
      enableDht: false,
    },
  });

  await agent.joinRoom(NETWORK_ROOM);
  console.log(`  DID: ${agent.getIdentity().did}`);
  console.log(`  Room: ${NETWORK_ROOM}`);
  console.log(`  Reading every ${READ_INTERVAL / 1000}s\n`);

  // ─── Collection loop ──────────────────────────────────────────

  let alertCount = 0;

  setInterval(async () => {
    const value = readSensor();
    const ts = new Date().toISOString().slice(11, 19);

    // Check alerts
    let alert = null;
    if (value > ALERT_HIGH) {
      alert = { level: 'high', reason: `${SENSOR_TYPE} above ${ALERT_HIGH}${SENSOR_UNIT}` };
    } else if (value < ALERT_LOW) {
      alert = { level: 'low', reason: `${SENSOR_TYPE} below ${ALERT_LOW}${SENSOR_UNIT}` };
    }

    const status = alert ? `⚠️  ${value}${SENSOR_UNIT}` : `${value}${SENSOR_UNIT}`;
    console.log(`[${ts}] ${SENSOR_NAME}: ${status}`);

    // Broadcast via P2P
    await agent.sendMessage(NETWORK_ROOM, JSON.stringify({
      type: 'sensor_reading',
      sensorId: SENSOR_NAME,
      sensorType: SENSOR_TYPE,
      value,
      unit: SENSOR_UNIT,
      alert,
      timestamp: Date.now(),
    })).catch(() => {});

    if (alert) alertCount++;
  }, READ_INTERVAL);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log(`\n${SENSOR_NAME} shutting down (${alertCount} alerts sent)`);
    await agent.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
```

## Step 3: Create the Coordinator

The coordinator aggregates readings, runs AI analysis, and manages alerts. Deploy on a more powerful device (Intel NUC or server).

Create `/opt/sensor-coordinator/coordinator.js`:

```javascript
import { createClient } from 'society-protocol';

const NETWORK_ROOM = process.env.NETWORK_ROOM || 'farm-sensors';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.MODEL || 'qwen3:1.7b';
const RELAY_ADDR = process.env.RELAY_ADDR || '';

// ─── State ──────────────────────────────────────────────────────

const latestReadings = new Map();  // sensorId → latest reading
const alertHistory = [];           // Recent alerts

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const agent = await createClient({
    identity: { name: 'coordinator' },
    storage: { path: './data/coordinator.db' },
    network: {
      bootstrapPeers: RELAY_ADDR ? [RELAY_ADDR] : [],
      enableGossipsub: true,
      enableMdns: !RELAY_ADDR,
      enableDht: true,
    },
  });

  await agent.joinRoom(NETWORK_ROOM);

  // Create knowledge space
  const space = await agent.createKnowledgeSpace(
    'Sensor Analytics', 'Historical sensor data and analysis', 'team'
  );

  console.log('Coordinator online. Listening for sensor data...\n');

  // ─── Listen for readings ──────────────────────────────────────

  agent.on('message', async (data) => {
    const text = typeof data.body?.text === 'string' ? data.body.text : String(data.text || '');
    try {
      const msg = JSON.parse(text);
      if (msg.type !== 'sensor_reading') return;

      latestReadings.set(msg.sensorId, msg);

      if (msg.alert) {
        alertHistory.push({ ...msg.alert, sensorId: msg.sensorId, timestamp: msg.timestamp });
        console.log(`⚠️  ALERT: ${msg.sensorId} — ${msg.alert.reason}`);

        // AI analysis when alerts accumulate
        if (alertHistory.length % 3 === 0) {
          await runAnalysis(agent, space.id);
        }
      }
    } catch { /* not JSON */ }
  });

  // ─── Periodic summary ─────────────────────────────────────────

  setInterval(() => {
    if (latestReadings.size === 0) return;
    console.log(`\n── Status (${latestReadings.size} sensors) ──`);
    for (const [id, r] of latestReadings) {
      const age = Math.round((Date.now() - r.timestamp) / 1000);
      console.log(`  ${id}: ${r.value}${r.unit} (${age}s ago)`);
    }
  }, 30_000);

  process.on('SIGINT', async () => {
    await agent.disconnect();
    process.exit(0);
  });
}

// ─── AI Analysis ────────────────────────────────────────────────

async function runAnalysis(agent, spaceId) {
  const readings = Array.from(latestReadings.values());
  const recentAlerts = alertHistory.slice(-10);

  const prompt =
    `You are an IoT monitoring AI. Analyze these sensor readings:\n\n` +
    readings.map(r => `${r.sensorId} (${r.sensorType}): ${r.value}${r.unit}`).join('\n') +
    `\n\nRecent alerts:\n` +
    recentAlerts.map(a => `- ${a.sensorId}: ${a.reason}`).join('\n') +
    `\n\nProvide a brief assessment and recommended actions.`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: false, options: { num_predict: 200 } }),
    });
    const analysis = (await res.json()).response;
    console.log(`\n🤖 AI Analysis: ${analysis}\n`);

    // Store as knowledge card
    await agent.createKnowledgeCard(spaceId, 'finding',
      `Alert Analysis ${new Date().toISOString().split('T')[0]}`,
      analysis,
      { tags: ['alert', 'analysis'], confidence: 0.85 }
    );
  } catch (err) {
    console.log(`[AI unavailable: ${err.message}]`);
  }
}

main().catch(console.error);
```

## Step 4: Deploy Sensors

### systemd Service (Per Sensor)

```ini
# /etc/systemd/system/sensor-agent.service
[Unit]
Description=Society IoT Sensor Agent
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/sensor-agent
ExecStart=/usr/bin/node sensor.js
Restart=always
RestartSec=10
Environment=SENSOR_NAME=soil-moisture-field-a
Environment=SENSOR_TYPE=soil-moisture
Environment=SENSOR_UNIT=%%
Environment=ALERT_LOW=30
Environment=ALERT_HIGH=70
Environment=READ_INTERVAL=10000
Environment=NETWORK_ROOM=farm-sensors

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now sensor-agent
sudo journalctl -u sensor-agent -f  # Watch logs
```

### Docker (Per Sensor)

```bash
docker run -d \
  --name soil-moisture-1 \
  --restart always \
  -e SENSOR_NAME=soil-moisture-1 \
  -e SENSOR_TYPE=soil-moisture \
  -e SENSOR_UNIT="%" \
  -e ALERT_LOW=30 \
  -e ALERT_HIGH=70 \
  -e READ_INTERVAL=10000 \
  -e NETWORK_ROOM=farm-sensors \
  -v sensor-data:/opt/sensor-agent/data \
  --network host \
  node:20-slim node /app/sensor.js
```

## Step 5: Docker Compose (Full Network)

```yaml
# docker-compose.yml
version: '3.8'

services:
  coordinator:
    image: node:20-slim
    working_dir: /app
    command: node coordinator.js
    volumes:
      - ./coordinator.js:/app/coordinator.js
      - coordinator-data:/app/data
    environment:
      NETWORK_ROOM: farm-sensors
      OLLAMA_URL: "http://ollama:11434"
    depends_on: [ollama]
    restart: always

  soil-moisture:
    image: node:20-slim
    working_dir: /app
    command: node sensor.js
    volumes:
      - ./sensor.js:/app/sensor.js
      - soil-data:/opt/sensor-agent/data
    environment:
      SENSOR_NAME: soil-moisture-1
      SENSOR_TYPE: soil-moisture
      SENSOR_UNIT: "%"
      ALERT_LOW: "30"
      ALERT_HIGH: "70"
      READ_INTERVAL: "10000"
      NETWORK_ROOM: farm-sensors
    restart: always

  temperature:
    image: node:20-slim
    working_dir: /app
    command: node sensor.js
    volumes:
      - ./sensor.js:/app/sensor.js
      - temp-data:/opt/sensor-agent/data
    environment:
      SENSOR_NAME: temperature-1
      SENSOR_TYPE: temperature
      SENSOR_UNIT: "°C"
      ALERT_LOW: "15"
      ALERT_HIGH: "38"
      READ_INTERVAL: "10000"
      NETWORK_ROOM: farm-sensors
    restart: always

  soil-ph:
    image: node:20-slim
    working_dir: /app
    command: node sensor.js
    volumes:
      - ./sensor.js:/app/sensor.js
      - ph-data:/opt/sensor-agent/data
    environment:
      SENSOR_NAME: ph-sensor-1
      SENSOR_TYPE: soil-ph
      SENSOR_UNIT: "pH"
      ALERT_LOW: "5.5"
      ALERT_HIGH: "7.5"
      READ_INTERVAL: "30000"
      NETWORK_ROOM: farm-sensors
    restart: always

  ollama:
    image: ollama/ollama
    volumes: [ollama-models:/root/.ollama]
    restart: always

volumes:
  coordinator-data:
  soil-data:
  temp-data:
  ph-data:
  ollama-models:
```

```bash
docker compose up -d
docker exec ollama ollama pull qwen3:1.7b
docker compose logs -f coordinator  # Watch analysis
```

## Step 6: Connect Real Hardware Sensors

Replace the `readSensor()` function with actual hardware readings.

### BME280 (Temperature + Humidity via I2C)

```bash
npm install bme280-sensor
```

```javascript
import BME280 from 'bme280-sensor';

const bme = new BME280({ i2cBusNo: 1, i2cAddress: 0x76 });
await bme.init();

function readSensor() {
  const { temperature_C } = bme.readSensorData();
  return Math.round(temperature_C * 100) / 100;
}
```

### Capacitive Soil Moisture (via ADS1115 ADC)

```bash
npm install ads1115
```

```javascript
import Ads1115 from 'ads1115';

const ads = await Ads1115.open(1, 0x48);

function readSensor() {
  const raw = ads.measure('0+GND');
  // Calibrate: dry=26000 (0%), wet=11000 (100%)
  return Math.round(Math.max(0, Math.min(100, (26000 - raw) / 150)));
}
```

### Serial Sensor (RS485/Modbus)

```bash
npm install serialport @serialport/parser-readline
```

```javascript
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

const port = new SerialPort({ path: '/dev/ttyUSB0', baudRate: 9600 });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

let lastValue = 0;
parser.on('data', (line) => { lastValue = parseFloat(line); });

function readSensor() {
  return lastValue;
}
```

## Step 7: Remote Deployment (Multi-Site)

For sensors across different locations (e.g., multiple farms):

```
Farm A (Local Mesh)          Farm B (Local Mesh)
┌──────┐ ┌──────┐           ┌──────┐ ┌──────┐
│ S1   │ │ S2   │           │ S3   │ │ S4   │
└──┬───┘ └──┬───┘           └──┬───┘ └──┬───┘
   └───┬────┘                  └───┬────┘
       │                           │
   ┌───▼───┐                   ┌───▼───┐
   │Gateway│                   │Gateway│
   │  (Pi) │                   │  (Pi) │
   └───┬───┘                   └───┬───┘
       │                           │
       └─────── Cloud Relay ───────┘
                    │
             ┌──────▼───────┐
             │ Coordinator  │
             └──────────────┘
```

Each site has a gateway Pi that relays to the cloud:

```bash
# On gateway Pi
RELAY_ADDR="/dns4/relay.farm.example.com/tcp/443/wss" \
NETWORK_ROOM=multi-farm \
node sensor.js
```

## Step 8: Alerting Integration

Add external alerts to the coordinator:

```javascript
// Slack webhook
async function sendSlackAlert(alert) {
  await fetch(process.env.SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `🚨 *Sensor Alert*\n${alert.sensorId}: ${alert.reason}`,
    }),
  });
}

// In the message handler, after detecting an alert:
if (msg.alert) {
  await sendSlackAlert({ sensorId: msg.sensorId, ...msg.alert });
}
```

## Production Checklist

- [ ] Each sensor has persistent storage (`DB_PATH` on SD card or USB)
- [ ] systemd services with `Restart=always`
- [ ] Watchdog timer for hardware sensor failures
- [ ] NTP sync on all devices for accurate timestamps
- [ ] Relay node deployed with TLS for multi-site
- [ ] Slack/PagerDuty alerting configured on coordinator
- [ ] Ollama model pulled on coordinator
- [ ] Backup: rsync sensor DBs to central storage weekly
- [ ] Monitoring: check peer count periodically
- [ ] Power: UPS for critical sensors, solar for remote deployments

## Scaling

| Sensors | Coordinator | Network | Notes |
|---------|-------------|---------|-------|
| 1-10 | Raspberry Pi 4 | mDNS (LAN) | Single-site, no relay needed |
| 10-50 | Intel NUC | mDNS + relay | Multi-site with gateway |
| 50-200 | Server (4GB+) | Relay + DHT | Enable DHT for dynamic discovery |
| 200+ | Server (8GB+) | Federation | Split by region, bridge data |
