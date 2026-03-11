/**
 * Auto-Configuration Module
 * 
 * Detecta ambiente automaticamente e gera configuração otimizada
 * - Recursos disponíveis (CPU, RAM, disco, rede)
 - Ambiente (home, datacenter, cloud, mobile)
 * - Padrão de uso (light, full-node, relay)
 * - Configura de porta automática
 */

import { cpus, totalmem, freemem, networkInterfaces, platform, homedir, loadavg } from 'os';
import { existsSync, statfsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { detectCloudEnvironment } from './bootstrap.js';

const execAsync = promisify(exec);

export interface SystemResources {
  cpu: {
    cores: number;
    model: string;
    speed: number; // MHz
    loadAvg: number[];
  };
  memory: {
    total: number; // bytes
    free: number;  // bytes
    available: number; // bytes (different on Linux)
  };
  disk: {
    path: string;
    total: number; // bytes
    free: number;  // bytes
    type: string;
  };
  network: {
    interfaces: Record<string, NetworkInterfaceInfo[]>;
    hasPublicIP: boolean;
    estimatedBandwidth: number; // Mbps, 0 if unknown
  };
}

export interface NetworkInterfaceInfo {
  address: string;
  family: string;
  internal: boolean;
}

export interface DetectedEnvironment {
  type: 'home' | 'office' | 'datacenter' | 'cloud' | 'mobile' | 'unknown';
  cloudProvider?: 'aws' | 'gcp' | 'azure' | 'digitalocean' | 'heroku' | 'other';
  hasPublicIP: boolean;
  behindNAT: boolean;
  canBeRelay: boolean;
}

export interface UsagePattern {
  type: 'light' | 'standard' | 'full' | 'relay';
  maxConnections: number;
  cacheSizeMB: number;
  enableDHT: boolean;
  enableRelay: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface AutoConfig {
  environment: DetectedEnvironment;
  resources: SystemResources;
  usage: UsagePattern;
  recommended: {
    p2pPort: number;
    apiPort: number;
    wsPort: number;
    storagePath: string;
    maxPeers: number;
    connectionLimits: {
      min: number;
      max: number;
    };
  };
}

export class AutoConfigurator {
  private configDir: string;

  constructor() {
    this.configDir = join(homedir(), '.society');
  }

  /**
   * Detect system resources
   */
  async detectResources(): Promise<SystemResources> {
    // CPU info
    const cpuInfo = cpus();
    const avgLoad = platform() !== 'win32' ? loadavg() : [0, 0, 0];

    // Memory info
    const memTotal = totalmem();
    const memFree = freemem();
    let memAvailable = memFree;

    // On Linux, we can get more accurate available memory
    if (platform() === 'linux') {
      try {
        const meminfo = readFileSync('/proc/meminfo', 'utf-8');
        const availableMatch = meminfo.match(/MemAvailable:\s+(\d+)/);
        if (availableMatch) {
          memAvailable = parseInt(availableMatch[1]) * 1024;
        }
      } catch {}
    }

    // Disk info - find best location for storage
    const storagePath = this.findBestStoragePath();
    let diskInfo = { total: 0, free: 0, type: 'unknown' };
    
    try {
      const stats = statfsSync(storagePath);
      diskInfo = {
        total: stats.blocks * stats.bsize,
        free: stats.bavail * stats.bsize,
        type: this.detectFilesystemType(storagePath)
      };
    } catch {}

    // Network info
    const interfaces = networkInterfaces();
    const hasPublicIP = this.detectPublicIP(interfaces);
    const bandwidth = await this.estimateBandwidth();

    return {
      cpu: {
        cores: cpuInfo.length,
        model: cpuInfo[0]?.model || 'unknown',
        speed: cpuInfo[0]?.speed || 0,
        loadAvg: avgLoad
      },
      memory: {
        total: memTotal,
        free: memFree,
        available: memAvailable
      },
      disk: {
        path: storagePath,
        total: diskInfo.total,
        free: diskInfo.free,
        type: diskInfo.type
      },
      network: {
        interfaces,
        hasPublicIP,
        estimatedBandwidth: bandwidth
      }
    };
  }

  /**
   * Find best storage path (most free space)
   */
  private findBestStoragePath(): string {
    const candidates = [
      join(homedir(), '.society', 'storage'),
      platform() === 'darwin' ? '/opt/society/storage' : '',
      platform() === 'linux' ? '/var/lib/society' : '',
      join(homedir(), 'society-data')
    ].filter(Boolean);

    let bestPath = candidates[0];
    let maxFree = 0;

    for (const path of candidates) {
      try {
        if (!existsSync(path)) {
          mkdirSync(path, { recursive: true });
        }
        const stats = statfsSync(path);
        const free = stats.bavail * stats.bsize;
        if (free > maxFree) {
          maxFree = free;
          bestPath = path;
        }
      } catch {}
    }

    return bestPath;
  }

  /**
   * Detect filesystem type
   */
  private detectFilesystemType(path: string): string {
    try {
      if (platform() === 'linux') {
        const { stdout } = exec('df -T ' + path);
        // Parse output to get filesystem type
        return 'ext4'; // Simplified
      }
      if (platform() === 'darwin') {
        return 'apfs';
      }
    } catch {}
    return 'unknown';
  }

  /**
   * Detect if machine has public IP
   */
  private detectPublicIP(interfaces: Record<string, any[]>): boolean {
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (name.startsWith('lo')) continue;
      for (const addr of addrs) {
        if (addr.internal) continue;
        if (addr.family !== 'IPv4') continue;
        
        // Check if not private IP
        const ip = addr.address;
        if (!this.isPrivateIP(ip)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if IP is private
   */
  private isPrivateIP(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    return false;
  }

  /**
   * Estimate network bandwidth (rough)
   */
  private async estimateBandwidth(): Promise<number> {
    try {
      // Quick ping to estimate latency, then rough bandwidth estimate
      const start = Date.now();
      
      // Try to fetch a small test file or use ping
      if (platform() !== 'win32') {
        await execAsync('ping -c 1 -W 2 1.1.1.1', { timeout: 5000 });
      }
      
      const latency = Date.now() - start;
      
      // Very rough heuristic based on latency
      if (latency < 10) return 1000;    // < 10ms = likely datacenter, 1Gbps
      if (latency < 50) return 100;     // < 50ms = likely fiber, 100Mbps
      if (latency < 100) return 25;     // < 100ms = cable, 25Mbps
      return 10;                         // default assumption
    } catch {
      return 0; // unknown
    }
  }

  /**
   * Detect environment type
   */
  async detectEnvironment(): Promise<DetectedEnvironment> {
    const cloudProvider = detectCloudEnvironment();
    const resources = await this.detectResources();
    
    let type: DetectedEnvironment['type'] = 'unknown';
    
    if (cloudProvider !== 'local') {
      type = 'cloud';
    } else {
      // Heuristics for home vs office vs datacenter
      const memGB = resources.memory.total / (1024 ** 3);
      const cores = resources.cpu.cores;
      
      if (memGB < 4 && cores <= 2) {
        type = 'mobile';
      } else if (resources.network.hasPublicIP && memGB > 16) {
        type = 'datacenter';
      } else {
        type = 'home';
      }
    }

    const canBeRelay = resources.network.hasPublicIP && 
                       resources.memory.total > 4 * 1024 ** 3 &&
                       resources.cpu.cores >= 2;

    return {
      type,
      cloudProvider: type === 'cloud' ? cloudProvider as any : undefined,
      hasPublicIP: resources.network.hasPublicIP,
      behindNAT: !resources.network.hasPublicIP,
      canBeRelay
    };
  }

  /**
   * Determine optimal usage pattern based on resources
   */
  async determineUsagePattern(): Promise<UsagePattern> {
    const resources = await this.detectResources();
    const env = await this.detectEnvironment();
    
    const memGB = resources.memory.total / (1024 ** 3);
    const cores = resources.cpu.cores;
    const freeDiskGB = resources.disk.free / (1024 ** 3);

    // Decision tree for usage pattern
    if (env.canBeRelay && memGB >= 8) {
      return {
        type: 'relay',
        maxConnections: 1000,
        cacheSizeMB: Math.min(2048, Math.floor(memGB * 100)),
        enableDHT: true,
        enableRelay: true,
        logLevel: 'info'
      };
    }

    if (memGB >= 4 && cores >= 2) {
      return {
        type: 'full',
        maxConnections: 100,
        cacheSizeMB: Math.min(512, Math.floor(memGB * 64)),
        enableDHT: true,
        enableRelay: false,
        logLevel: 'info'
      };
    }

    if (memGB >= 2) {
      return {
        type: 'standard',
        maxConnections: 50,
        cacheSizeMB: 256,
        enableDHT: true,
        enableRelay: false,
        logLevel: 'warn'
      };
    }

    return {
      type: 'light',
      maxConnections: 10,
      cacheSizeMB: 64,
      enableDHT: false,
      enableRelay: false,
      logLevel: 'warn'
    };
  }

  /**
   * Find available port
   */
  private async findAvailablePort(preferred: number, range: number[] = []): Promise<number> {
    const net = await import('net');
    
    const ports = [preferred, ...range];
    
    for (const port of ports) {
      try {
        const server = net.createServer();
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.once('listening', resolve);
          server.listen(port, '127.0.0.1');
        });
        server.close();
        return port;
      } catch {
        continue;
      }
    }
    
    // If none available, get random port
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as any).port;
        server.close(() => resolve(port));
      });
      server.once('error', reject);
    });
  }

  /**
   * Generate complete auto-configuration
   */
  async generateConfig(): Promise<AutoConfig> {
    const [resources, environment, usage] = await Promise.all([
      this.detectResources(),
      this.detectEnvironment(),
      this.determineUsagePattern()
    ]);

    // Find available ports
    const p2pPort = 0; // Let libp2p choose
    const apiPort = await this.findAvailablePort(8080, [8081, 8082, 8083, 8084, 8085]);
    const wsPort = await this.findAvailablePort(8081, [8082, 8083, 8084, 8085, 8086]);

    // Calculate connection limits based on resources
    const maxPeers = Math.min(
      usage.maxConnections,
      Math.floor(resources.memory.available / (50 * 1024 * 1024)) // 50MB per peer estimate
    );

    return {
      environment,
      resources,
      usage,
      recommended: {
        p2pPort,
        apiPort,
        wsPort,
        storagePath: resources.disk.path,
        maxPeers,
        connectionLimits: {
          min: Math.min(5, Math.floor(maxPeers * 0.1)),
          max: maxPeers
        }
      }
    };
  }

  /**
   * Apply configuration to config file
   */
  async applyConfig(config?: AutoConfig): Promise<void> {
    const autoConfig = config || await this.generateConfig();
    
    // Ensure config directory exists
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }

    const configPath = join(this.configDir, 'auto-config.yml');
    
    const yaml = `
# Auto-generated Society Configuration
# Generated: ${new Date().toISOString()}
# Environment: ${autoConfig.environment.type}

environment:
  type: ${autoConfig.environment.type}
  cloud_provider: ${autoConfig.environment.cloudProvider || 'none'}
  has_public_ip: ${autoConfig.environment.hasPublicIP}
  behind_nat: ${autoConfig.environment.behindNAT}
  can_be_relay: ${autoConfig.environment.canBeRelay}

resources:
  cpu:
    cores: ${autoConfig.resources.cpu.cores}
    model: "${autoConfig.resources.cpu.model}"
  memory:
    total_mb: ${Math.round(autoConfig.resources.memory.total / (1024 * 1024))}
    available_mb: ${Math.round(autoConfig.resources.memory.available / (1024 * 1024))}
  disk:
    path: ${autoConfig.resources.disk.path}
    free_gb: ${Math.round(autoConfig.resources.disk.free / (1024 ** 3))}

usage:
  pattern: ${autoConfig.usage.type}
  max_connections: ${autoConfig.usage.maxConnections}
  cache_size_mb: ${autoConfig.usage.cacheSizeMB}
  enable_dht: ${autoConfig.usage.enableDHT}
  enable_relay: ${autoConfig.usage.enableRelay}
  log_level: ${autoConfig.usage.logLevel}

network:
  p2p_port: ${autoConfig.recommended.p2pPort}
  api_port: ${autoConfig.recommended.apiPort}
  ws_port: ${autoConfig.recommended.wsPort}
  max_peers: ${autoConfig.recommended.maxPeers}
  connection_limits:
    min: ${autoConfig.recommended.connectionLimits.min}
    max: ${autoConfig.recommended.connectionLimits.max}
`.trim();

    writeFileSync(configPath, yaml);
    console.log(`[autoconfig] Configuration saved to ${configPath}`);
  }

  /**
   * Print detected configuration (for CLI)
   */
  async printConfig(): Promise<void> {
    const config = await this.generateConfig();
    
    console.log('\n📊 Detected System Configuration:\n');
    console.log(`  Environment: ${config.environment.type}`);
    if (config.environment.cloudProvider) {
      console.log(`  Cloud: ${config.environment.cloudProvider}`);
    }
    console.log(`  Public IP: ${config.environment.hasPublicIP ? 'Yes ✓' : 'No (behind NAT)'}`);
    console.log(`  Can be relay: ${config.environment.canBeRelay ? 'Yes ✓' : 'No'}`);
    console.log('');
    console.log(`  CPU: ${config.resources.cpu.cores} cores (${config.resources.cpu.model})`);
    console.log(`  Memory: ${(config.resources.memory.total / (1024 ** 3)).toFixed(1)} GB`);
    console.log(`  Disk: ${(config.resources.disk.free / (1024 ** 3)).toFixed(1)} GB free`);
    console.log('');
    console.log(`  Recommended mode: ${config.usage.type.toUpperCase()}`);
    console.log(`  Max peers: ${config.recommended.maxPeers}`);
    console.log(`  API port: ${config.recommended.apiPort}`);
    console.log(`  Cache: ${config.usage.cacheSizeMB} MB`);
    console.log('');
  }
}

/**
 * Quick auto-config
 */
export async function autoConfigure(): Promise<AutoConfig> {
  const configurator = new AutoConfigurator();
  const config = await configurator.generateConfig();
  await configurator.applyConfig(config);
  return config;
}

/**
 * Detect if running in CI/CD environment
 */
export function detectCI(): { isCI: boolean; provider?: string } {
  const envVars = [
    'CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS', 'GITLAB_CI',
    'CIRCLECI', 'TRAVIS', 'JENKINS_URL', 'BUILDKITE', 'DRONE'
  ];

  for (const env of envVars) {
    if (process.env[env]) {
      return { isCI: true, provider: env };
    }
  }

  return { isCI: false };
}

/**
 * Detect if running in Docker/container
 */
export function detectContainer(): boolean {
  try {
    const cgroup = readFileSync('/proc/self/cgroup', 'utf-8');
    return cgroup.includes('docker') || cgroup.includes('containerd');
  } catch {
    return existsSync('/.dockerenv');
  }
}
