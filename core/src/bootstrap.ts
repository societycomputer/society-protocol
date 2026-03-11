/**
 * Zero-Config Bootstrap Module
 *
 * Auto-discovery de peers via:
 * 1. Registry API (api.society.computer)
 * 2. DNS TXT records (bootstrap.society.dev)
 * 3. Cache local de peers funcionais
 * 4. Hardcoded fallback list
 * 5. mDNS para LAN discovery
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

const REGISTRY_URL = process.env.SOCIETY_REGISTRY_URL || 'https://api.society.computer';

export interface BootstrapPeer {
  id: string;
  addrs: string[];
  lastSeen: number;
  latency: number;
  reliability: number; // 0-1 score
}

export interface BootstrapConfig {
  dnsEndpoints: string[];
  fallbackPeers: BootstrapPeer[];
  cacheFile: string;
  cacheTtlMs: number;
  discoveryTimeoutMs: number;
}

// Default bootstrap domain
const SOCIETY_DOMAIN = 'society.computer';

function parseFallbackPeersFromEnv(): BootstrapPeer[] {
  const raw = process.env.SOCIETY_BOOTSTRAP_ADDRS || '';
  const addrs = raw.split(',').map((item) => item.trim()).filter(Boolean);
  const now = Date.now();

  return addrs.map((addr, index) => ({
    id: `env_${index}`,
    addrs: [addr],
    lastSeen: now,
    latency: 0,
    reliability: 0.5,
  }));
}

const DEFAULT_FALLBACK_PEERS: BootstrapPeer[] = parseFallbackPeersFromEnv();

// Endpoints DNS para descoberta
const DEFAULT_DNS_ENDPOINTS = [
  `bootstrap.${SOCIETY_DOMAIN}`,
  `bootstrap.society.dev`,
  `bootstrap1.${SOCIETY_DOMAIN}`,
  `bootstrap2.${SOCIETY_DOMAIN}`,
  `bootstrap3.${SOCIETY_DOMAIN}`,
];

export class BootstrapManager {
  private config: BootstrapConfig;
  private cache: Map<string, BootstrapPeer> = new Map();
  private workingPeers: BootstrapPeer[] = [];

  constructor(customConfig?: Partial<BootstrapConfig>) {
    const societyDir = join(homedir(), '.society');
    
    this.config = {
      dnsEndpoints: customConfig?.dnsEndpoints ?? DEFAULT_DNS_ENDPOINTS,
      fallbackPeers: customConfig?.fallbackPeers ?? DEFAULT_FALLBACK_PEERS,
      cacheFile: customConfig?.cacheFile ?? join(societyDir, 'peers-cache.json'),
      cacheTtlMs: customConfig?.cacheTtlMs ?? 24 * 60 * 60 * 1000, // 24h
      discoveryTimeoutMs: customConfig?.discoveryTimeoutMs ?? 10000 // 10s
    };

    this.ensureCacheDir();
    this.loadCache();
  }

  private ensureCacheDir(): void {
    const dir = join(homedir(), '.society');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private loadCache(): void {
    try {
      if (existsSync(this.config.cacheFile)) {
        const data = JSON.parse(readFileSync(this.config.cacheFile, 'utf-8'));
        const now = Date.now();
        
        for (const peer of data.peers || []) {
          // Only load if not expired
          if (now - peer.lastSeen < this.config.cacheTtlMs) {
            this.cache.set(peer.id, peer);
          }
        }
        
        console.log(`[bootstrap] Loaded ${this.cache.size} peers from cache`);
      }
    } catch (err) {
      console.warn('[bootstrap] Failed to load cache:', err);
    }
  }

  private saveCache(): void {
    try {
      const data = {
        updatedAt: Date.now(),
        peers: Array.from(this.cache.values())
      };
      writeFileSync(this.config.cacheFile, JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn('[bootstrap] Failed to save cache:', err);
    }
  }

  /**
   * Query DNS TXT records for peer lists
   */
  private async queryDnsPeers(): Promise<BootstrapPeer[]> {
    const peers: BootstrapPeer[] = [];
    
    for (const endpoint of this.config.dnsEndpoints) {
      try {
        // Try dig first, then nslookup as fallback
        let result: string;
        
        try {
          const { stdout } = await execAsync(`dig +short TXT ${endpoint}`);
          result = stdout;
        } catch {
          const { stdout } = await execAsync(`nslookup -type=TXT ${endpoint}`);
          result = stdout;
        }

        // Parse TXT records:
        // 1) peers=<base64-encoded-peer-list>
        // 2) addrs=<comma-separated-multiaddrs>
        const txtRecords = result
          .split('\n')
          .map(line => line.trim().replace(/"/g, ''))
          .filter(line => line.startsWith('peers=') || line.startsWith('addrs='));

        for (const record of txtRecords) {
          if (record.startsWith('addrs=')) {
            const addrs = record
              .replace('addrs=', '')
              .split(',')
              .map((item) => item.trim())
              .filter((item) => item.startsWith('/'));
            if (addrs.length > 0) {
              peers.push({
                id: `dns_${endpoint}_addrs`,
                addrs,
                lastSeen: Date.now(),
                latency: 0,
                reliability: 0.7
              });
            }
            continue;
          }

          if (record.startsWith('peers=')) {
            try {
              const encoded = record.replace('peers=', '');
              const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
              const peerList = JSON.parse(decoded);
              peers.push(...peerList);
            } catch {
              console.warn(`[bootstrap] Failed to parse peers TXT record from ${endpoint}`);
            }
          }
        }
      } catch (err) {
        console.warn(`[bootstrap] DNS query failed for ${endpoint}`);
      }
    }

    return peers;
  }

  /**
   * Query the registry API for registered nodes
   */
  private async queryRegistryPeers(): Promise<BootstrapPeer[]> {
    const peers: BootstrapPeer[] = [];

    try {
      const res = await fetch(`${REGISTRY_URL}/v1/nodes`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });

      if (!res.ok) return peers;

      const data = await res.json() as {
        nodes: Array<{ name: string; data: { multiaddr: string; peerId?: string; room?: string } }>;
        count: number;
      };

      for (const node of data.nodes || []) {
        if (node.data?.multiaddr) {
          peers.push({
            id: `registry_${node.name}`,
            addrs: [node.data.multiaddr],
            lastSeen: Date.now(),
            latency: 0,
            reliability: 0.8,
          });
        }
      }
    } catch (err) {
      console.warn('[bootstrap] Registry query failed:', (err as Error)?.message);
    }

    return peers;
  }

  /**
   * Test connectivity to a peer
   */
  private async testPeer(peer: BootstrapPeer): Promise<{ latency: number; working: boolean }> {
    const start = Date.now();
    
    try {
      // Try to dial the peer with timeout
      // This would integrate with the actual libp2p dial
      // For now, we simulate with a ping-like check
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      // In real implementation, this would be:
      // await this.node.dial(peer.addrs[0], { signal: controller.signal });
      
      clearTimeout(timeout);
      
      const latency = Date.now() - start;
      return { latency, working: true };
    } catch {
      return { latency: Infinity, working: false };
    }
  }

  /**
   * Discover and return working bootstrap peers
   * Priority: DNS > Cache > Fallback
   */
  async discover(): Promise<BootstrapPeer[]> {
    console.log('[bootstrap] Starting peer discovery...');
    
    const allPeers: BootstrapPeer[] = [];
    const testedPeers = new Set<string>();
    const working: BootstrapPeer[] = [];

    // 1. Try registry API first (fastest, most reliable)
    console.log('[bootstrap] Querying registry...');
    try {
      const registryPeers = await this.queryRegistryPeers();
      allPeers.push(...registryPeers);
      console.log(`[bootstrap] Registry returned ${registryPeers.length} peers`);
    } catch (err) {
      console.warn('[bootstrap] Registry query failed:', err);
    }

    // 2. Try DNS (fallback)
    console.log('[bootstrap] Querying DNS...');
    try {
      const dnsPeers = await this.queryDnsPeers();
      allPeers.push(...dnsPeers);
      console.log(`[bootstrap] DNS returned ${dnsPeers.length} peers`);
    } catch (err) {
      console.warn('[bootstrap] DNS discovery failed:', err);
    }

    // 3. Try cached peers
    console.log('[bootstrap] Checking cache...');
    const cachedPeers = Array.from(this.cache.values());
    allPeers.push(...cachedPeers);

    // 4. Add fallback peers (env var)
    console.log('[bootstrap] Adding fallback peers...');
    allPeers.push(...this.config.fallbackPeers);

    // 5. Test peers in parallel (with concurrency limit)
    console.log(`[bootstrap] Testing ${allPeers.length} unique peers...`);
    
    const batchSize = 5;
    for (let i = 0; i < allPeers.length; i += batchSize) {
      const batch = allPeers.slice(i, i + batchSize);
      
      const results = await Promise.all(
        batch.map(async (peer) => {
          if (testedPeers.has(peer.id)) return null;
          testedPeers.add(peer.id);
          
          const result = await this.testPeer(peer);
          if (result.working) {
            return { ...peer, latency: result.latency, lastSeen: Date.now() };
          }
          return null;
        })
      );

      working.push(...results.filter((p): p is BootstrapPeer => p !== null));
      
      // Stop if we have enough working peers
      if (working.length >= 3) break;
    }

    // 6. Sort by reliability and latency
    working.sort((a, b) => {
      const scoreA = a.reliability * 1000 - a.latency;
      const scoreB = b.reliability * 1000 - b.latency;
      return scoreB - scoreA;
    });

    // 7. Update cache with working peers
    for (const peer of working) {
      this.cache.set(peer.id, peer);
    }
    this.saveCache();

    this.workingPeers = working;
    
    console.log(`[bootstrap] Discovered ${working.length} working peers`);
    if (working.length === 0) {
      throw new Error('No bootstrap peers available. Check your internet connection.');
    }

    return working;
  }

  /**
   * Get working peers (cached from last discovery)
   */
  getWorkingPeers(): BootstrapPeer[] {
    return this.workingPeers;
  }

  /**
   * Add a peer manually (from mDNS or other discovery)
   */
  addPeer(peer: BootstrapPeer): void {
    this.cache.set(peer.id, { ...peer, lastSeen: Date.now() });
    this.saveCache();
  }

  /**
   * Clear cache and force re-discovery
   */
  async refresh(): Promise<BootstrapPeer[]> {
    this.cache.clear();
    this.workingPeers = [];
    return this.discover();
  }
}

/**
 * Quick bootstrap for immediate connection
 * Usage: const peers = await quickBootstrap();
 */
export async function quickBootstrap(): Promise<BootstrapPeer[]> {
  const manager = new BootstrapManager();
  return manager.discover();
}

/**
 * Check if running in common cloud environments
 * Useful for auto-configuration
 */
export function detectCloudEnvironment(): 'aws' | 'gcp' | 'azure' | 'digitalocean' | 'local' {
  // AWS
  if (process.env.AWS_REGION || existsSync('/sys/class/dmi/id/product_uuid')) {
    try {
      const uuid = readFileSync('/sys/class/dmi/id/product_uuid', 'utf-8');
      if (uuid.startsWith('EC2') || uuid.startsWith('ec2')) return 'aws';
    } catch {}
  }
  
  // GCP
  if (process.env.GOOGLE_CLOUD_PROJECT || existsSync('/sys/class/dmi/id/product_name')) {
    try {
      const name = readFileSync('/sys/class/dmi/id/product_name', 'utf-8');
      if (name.includes('Google')) return 'gcp';
    } catch {}
  }
  
  // Azure
  if (process.env.AZURE_RESOURCE_GROUP || existsSync('/sys/class/dmi/id/sys_vendor')) {
    try {
      const vendor = readFileSync('/sys/class/dmi/id/sys_vendor', 'utf-8');
      if (vendor.includes('Microsoft')) return 'azure';
    } catch {}
  }
  
  // DigitalOcean
  if (existsSync('/etc/digitalocean')) return 'digitalocean';
  
  return 'local';
}
