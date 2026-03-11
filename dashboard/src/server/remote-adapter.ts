/**
 * Remote adapter: proxies dashboard WebSocket to an external Society node.
 *
 * In remote mode, the dashboard connects to an already-running Society node
 * via its WebSocket API, rather than running its own embedded SocietyClient.
 *
 * TODO: Implement when the Society node exposes a WS API.
 * For now, the dashboard always runs in embedded mode.
 */

export interface RemoteAdapterConfig {
  url: string; // ws://host:port/ws
}

export class RemoteAdapter {
  private url: string;

  constructor(config: RemoteAdapterConfig) {
    this.url = config.url;
  }

  async connect(): Promise<void> {
    console.log(`[RemoteAdapter] Would connect to ${this.url}`);
    throw new Error(
      'Remote mode is not yet implemented. ' +
      'The Society node needs to expose a WebSocket API first. ' +
      'Use embedded mode (without --connect) for now.'
    );
  }
}
