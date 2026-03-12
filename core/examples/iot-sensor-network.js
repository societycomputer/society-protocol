#!/usr/bin/env node
/**
 * Society Protocol — IoT Sensor Network
 *
 * Deploy a decentralized network of IoT sensor agents that
 * collect, analyze, and share environmental data. Each sensor
 * node is an autonomous agent with its own identity, capable
 * of peer-to-peer coordination without a central server.
 *
 * Use cases:
 *   - Smart agriculture (soil moisture, temperature, pH)
 *   - Environmental monitoring (air quality, water levels)
 *   - Industrial IoT (machine health, vibration analysis)
 *   - Smart city infrastructure (traffic, noise, pollution)
 *
 * Run: node examples/iot-sensor-network.js [agriculture|environment|industrial]
 */

import { createClient } from 'society-protocol';

// ─── Configuration ──────────────────────────────────────────────

const NETWORK_NAME = process.env.NETWORK_NAME || 'farm-sensors';
const REGION = process.env.REGION || 'field-north';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.MODEL || 'qwen3:1.7b';

// ─── Sensor Definitions ────────────────────────────────────────

const SENSOR_PROFILES = {
    agriculture: [
        { name: 'soil-moisture-1', type: 'soil-moisture', unit: '%', range: [20, 80], alertThreshold: { low: 30, high: 70 } },
        { name: 'temperature-1', type: 'temperature', unit: '°C', range: [10, 45], alertThreshold: { low: 15, high: 38 } },
        { name: 'ph-sensor-1', type: 'soil-ph', unit: 'pH', range: [4.0, 9.0], alertThreshold: { low: 5.5, high: 7.5 } },
        { name: 'humidity-1', type: 'air-humidity', unit: '%', range: [30, 95], alertThreshold: { low: 40, high: 85 } },
        { name: 'rain-gauge-1', type: 'rainfall', unit: 'mm', range: [0, 50], alertThreshold: { high: 30 } },
    ],
    environment: [
        { name: 'air-quality-1', type: 'aqi', unit: 'AQI', range: [0, 300], alertThreshold: { high: 150 } },
        { name: 'water-level-1', type: 'water-level', unit: 'cm', range: [50, 500], alertThreshold: { high: 400 } },
        { name: 'noise-1', type: 'noise', unit: 'dB', range: [30, 100], alertThreshold: { high: 85 } },
        { name: 'uv-index-1', type: 'uv', unit: 'index', range: [0, 11], alertThreshold: { high: 8 } },
    ],
    industrial: [
        { name: 'vibration-1', type: 'vibration', unit: 'mm/s', range: [0, 25], alertThreshold: { high: 15 } },
        { name: 'power-meter-1', type: 'power', unit: 'kW', range: [0, 500], alertThreshold: { high: 400 } },
        { name: 'thermal-1', type: 'thermal', unit: '°C', range: [20, 120], alertThreshold: { high: 95 } },
        { name: 'pressure-1', type: 'pressure', unit: 'bar', range: [0, 10], alertThreshold: { high: 8 } },
    ],
};

// ─── Sensor Agent ───────────────────────────────────────────────

class SensorAgent {
    constructor(profile, client) {
        this.profile = profile;
        this.client = client;
        this.readings = [];
        this.alertsSent = 0;
    }

    // Simulate a sensor reading
    read() {
        const [min, max] = this.profile.range;
        // Add some noise and drift
        const base = min + Math.random() * (max - min);
        const noise = (Math.random() - 0.5) * (max - min) * 0.1;
        const value = Math.round((base + noise) * 100) / 100;

        const reading = {
            sensorId: this.profile.name,
            type: this.profile.type,
            value,
            unit: this.profile.unit,
            timestamp: Date.now(),
            region: REGION,
        };

        this.readings.push(reading);
        if (this.readings.length > 100) this.readings.shift(); // Rolling window

        return reading;
    }

    // Check if reading triggers an alert
    checkAlert(reading) {
        const t = this.profile.alertThreshold;
        if (t.high && reading.value > t.high) return { level: 'warning', reason: `${reading.type} above threshold (${reading.value}${reading.unit} > ${t.high}${reading.unit})` };
        if (t.low && reading.value < t.low) return { level: 'warning', reason: `${reading.type} below threshold (${reading.value}${reading.unit} < ${t.low}${reading.unit})` };
        return null;
    }

    // Compute stats from recent readings
    getStats() {
        if (this.readings.length === 0) return null;
        const values = this.readings.map(r => r.value);
        return {
            min: Math.min(...values),
            max: Math.max(...values),
            avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
            count: values.length,
        };
    }
}

// ─── Sensor Network ─────────────────────────────────────────────

class SensorNetwork {
    constructor(mode) {
        this.mode = mode;
        this.profiles = SENSOR_PROFILES[mode] || SENSOR_PROFILES.agriculture;
        this.sensors = [];
        this.coordinator = null;
    }

    async deploy() {
        console.log(`\nDeploying ${this.mode} sensor network (${this.profiles.length} sensors)...\n`);

        // Create coordinator agent
        this.coordinator = await createClient({
            identity: { name: `${NETWORK_NAME}-coordinator` },
            storage: { path: ':memory:' },
            network: { enableGossipsub: true, enableMdns: true },
        });
        await this.coordinator.joinRoom(NETWORK_NAME);

        // Deploy sensor agents
        for (const profile of this.profiles) {
            const client = await createClient({
                identity: { name: profile.name },
                storage: { path: ':memory:' },
                network: {
                    listenAddrs: ['/ip4/0.0.0.0/tcp/0'],
                    enableGossipsub: true,
                    enableMdns: true,
                    enableDht: false,
                },
            });
            await client.joinRoom(NETWORK_NAME);

            const sensor = new SensorAgent(profile, client);
            this.sensors.push(sensor);
            console.log(`  ✓ ${profile.name} (${profile.type}) deployed`);
        }

        // Create knowledge space for historical data
        const space = await this.coordinator.createKnowledgeSpace(
            `${NETWORK_NAME} Data`,
            `Sensor readings and analysis for ${this.mode} network`,
            'team'
        );
        this.knowledgeSpaceId = space.id;

        console.log(`\n  Network deployed: ${this.sensors.length} sensors online\n`);
    }

    // Run one collection cycle
    async collectAndAnalyze() {
        console.log('── Collection Cycle ──\n');

        const allReadings = [];
        const alerts = [];

        // Collect readings from all sensors
        for (const sensor of this.sensors) {
            const reading = sensor.read();
            allReadings.push(reading);

            const alert = sensor.checkAlert(reading);
            if (alert) {
                alerts.push({ sensor: sensor.profile.name, ...alert, reading });
                sensor.alertsSent++;
            }

            // Broadcast reading via P2P
            await sensor.client.sendMessage(NETWORK_NAME, JSON.stringify({
                type: 'sensor_reading',
                ...reading,
            }));

            const status = alert ? `⚠️  ${reading.value}${reading.unit}` : `${reading.value}${reading.unit}`;
            console.log(`  [${sensor.profile.name}] ${status}`);
        }

        // Process alerts
        if (alerts.length > 0) {
            console.log(`\n  ⚠️  ${alerts.length} alert(s):`);
            for (const alert of alerts) {
                console.log(`    - ${alert.sensor}: ${alert.reason}`);
            }

            // AI analysis of alerts
            const analysis = await queryOllama(
                `You are an IoT monitoring system for a ${this.mode} deployment.\n\n` +
                `Current alerts:\n${alerts.map(a => `- ${a.reason}`).join('\n')}\n\n` +
                `All readings:\n${allReadings.map(r => `${r.type}: ${r.value}${r.unit}`).join('\n')}\n\n` +
                `Provide a brief assessment and recommended actions (2-3 sentences).`
            );
            console.log(`\n  AI Assessment: ${analysis.split('\n')[0]}`);

            // Store alert analysis as knowledge card
            await this.coordinator.createKnowledgeCard(
                this.knowledgeSpaceId,
                'finding',
                `Alert Analysis: ${new Date().toISOString().split('T')[0]}`,
                analysis,
                {
                    tags: ['alert', this.mode, ...alerts.map(a => a.sensor)],
                    confidence: 0.85,
                }
            );
        } else {
            console.log(`\n  ✓ All readings within normal range`);
        }

        // Stats summary
        console.log(`\n  Stats:`);
        for (const sensor of this.sensors) {
            const stats = sensor.getStats();
            if (stats) {
                console.log(`    ${sensor.profile.name}: avg=${stats.avg}${sensor.profile.unit} (${stats.min}-${stats.max}, n=${stats.count})`);
            }
        }

        return { readings: allReadings, alerts };
    }

    async shutdown() {
        console.log('\nShutting down sensor network...');
        await Promise.all(this.sensors.map(s => s.client.disconnect().catch(() => {})));
        await this.coordinator?.disconnect();
        console.log('Done.');
    }
}

// ─── Ollama Helper ──────────────────────────────────────────────

async function queryOllama(prompt) {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MODEL, prompt, stream: false, options: { temperature: 0.5, num_predict: 200 } }),
        });
        const data = await res.json();
        return data.response || 'No response';
    } catch (err) {
        return `[Model unavailable: ${err.message}]`;
    }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
    const mode = process.argv[2] || 'agriculture';
    const cycles = parseInt(process.argv[3] || '3', 10);

    const network = new SensorNetwork(mode);
    await network.deploy();

    // Run collection cycles
    for (let i = 0; i < cycles; i++) {
        console.log(`\n═══ Cycle ${i + 1}/${cycles} ═══\n`);
        await network.collectAndAnalyze();

        if (i < cycles - 1) {
            console.log(`\n  Waiting 5s for next cycle...`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    await network.shutdown();
}

main().catch(console.error);
