import { useCallback, useEffect, useRef, useState } from 'react';
import { useRpc } from '../hooks/useRpc';
import { useTopologyStore } from '../stores/topology';
import { useConnectionStore } from '../stores/connection';
import type { TopologySnapshot } from '../../shared/types';

interface GraphNode {
  id: string;
  name: string;
  isSelf: boolean;
  status: string;
  reputation?: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface GraphLink {
  source: string;
  target: string;
  transport?: string;
}

export function NetworkGraph() {
  const { refreshTopology, connected } = useRpc();
  const nodes = useTopologyStore((s) => s.nodes);
  const edges = useTopologyStore((s) => s.edges);
  const setSnapshot = useTopologyStore((s) => s.setSnapshot);
  const nodeInfo = useConnectionStore((s) => s.node);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>();
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const nodesRef = useRef<GraphNode[]>([]);

  // Fetch topology periodically
  useEffect(() => {
    if (!connected) return;
    const fetch = async () => {
      try {
        const snap = await refreshTopology();
        setSnapshot(snap);
      } catch { /* ignore */ }
    };
    fetch();
    const interval = setInterval(fetch, 5000);
    return () => clearInterval(interval);
  }, [connected, refreshTopology, setSnapshot]);

  // Update graph data when topology changes
  useEffect(() => {
    const gNodes: GraphNode[] = nodes.map((n) => {
      const existing = nodesRef.current.find((e) => e.id === n.id);
      return {
        id: n.id,
        name: n.name,
        isSelf: n.isSelf,
        status: n.status,
        reputation: n.reputation,
        x: existing?.x ?? Math.random() * 600 + 100,
        y: existing?.y ?? Math.random() * 400 + 100,
        vx: 0,
        vy: 0,
      };
    });
    const gLinks = edges.map((e) => ({
      source: e.source,
      target: e.target,
      transport: e.transport,
    }));
    nodesRef.current = gNodes;
    setGraphData({ nodes: gNodes, links: gLinks });
  }, [nodes, edges]);

  // Simple force simulation + render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resize();
    window.addEventListener('resize', resize);

    const statusColors: Record<string, string> = {
      online: '#10b981',
      busy: '#f59e0b',
      running: '#3b82f6',
      away: '#6b7280',
      offline: '#374151',
    };

    function tick() {
      if (!ctx || !canvas) return;
      const W = canvas.width;
      const H = canvas.height;
      const ns = nodesRef.current;
      const ls = graphData.links;

      // Simple force: repulsion + attraction + centering
      for (let i = 0; i < ns.length; i++) {
        const a = ns[i];
        // Center gravity
        a.vx! += (W / 2 - a.x!) * 0.001;
        a.vy! += (H / 2 - a.y!) * 0.001;

        for (let j = i + 1; j < ns.length; j++) {
          const b = ns[j];
          const dx = a.x! - b.x!;
          const dy = a.y! - b.y!;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 3000 / (dist * dist);
          a.vx! += (dx / dist) * force;
          a.vy! += (dy / dist) * force;
          b.vx! -= (dx / dist) * force;
          b.vy! -= (dy / dist) * force;
        }
      }

      // Link spring
      for (const link of ls) {
        const a = ns.find((n) => n.id === link.source);
        const b = ns.find((n) => n.id === link.target);
        if (!a || !b) continue;
        const dx = b.x! - a.x!;
        const dy = b.y! - a.y!;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 150) * 0.01;
        a.vx! += (dx / dist) * force;
        a.vy! += (dy / dist) * force;
        b.vx! -= (dx / dist) * force;
        b.vy! -= (dy / dist) * force;
      }

      // Apply velocity
      for (const n of ns) {
        n.vx! *= 0.9;
        n.vy! *= 0.9;
        n.x! += n.vx!;
        n.y! += n.vy!;
        n.x! = Math.max(30, Math.min(W - 30, n.x!));
        n.y! = Math.max(30, Math.min(H - 30, n.y!));
      }

      // Draw
      ctx.clearRect(0, 0, W, H);

      // Edges
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1;
      for (const link of ls) {
        const a = ns.find((n) => n.id === link.source);
        const b = ns.find((n) => n.id === link.target);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x!, a.y!);
        ctx.lineTo(b.x!, b.y!);
        ctx.stroke();
      }

      // Nodes
      for (const n of ns) {
        const r = n.isSelf ? 16 : 10 + (n.reputation || 0.5) * 6;
        const color = statusColors[n.status] || statusColors.offline;

        // Glow for self
        if (n.isSelf) {
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, r + 6, 0, Math.PI * 2);
          ctx.fillStyle = `${color}22`;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Label
        ctx.fillStyle = '#e5e7eb';
        ctx.font = n.isSelf ? 'bold 12px Space Grotesk' : '11px Space Grotesk';
        ctx.textAlign = 'center';
        ctx.fillText(n.name, n.x!, n.y! + r + 14);
      }

      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resize);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [graphData]);

  const peerCount = nodes.filter((n) => !n.isSelf).length;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Network Graph</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {peerCount} peer{peerCount !== 1 ? 's' : ''} connected
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Online
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Busy
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> Running
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-500" /> Away
          </span>
        </div>
      </div>
      <div className="flex-1 relative bg-gray-950">
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
            Waiting for peers...
          </div>
        )}
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>
    </div>
  );
}
