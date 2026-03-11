import { useState, useEffect } from 'react';
import { useChainsStore } from '../stores/chains';
import { useConnectionStore } from '../stores/connection';
import { useRpc } from '../hooks/useRpc';

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  running: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  completed: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  cancelled: 'bg-gray-700/20 text-gray-500 border-gray-700/30',
};

const STEP_COLORS: Record<string, string> = {
  proposed: 'bg-gray-700',
  unlocked: 'bg-blue-500',
  assigned: 'bg-amber-500',
  submitted: 'bg-purple-500',
  reviewed: 'bg-emerald-500',
  merged: 'bg-emerald-600',
  rejected: 'bg-red-500',
  cancelled: 'bg-gray-600',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-amber-400',
  normal: 'text-gray-400',
  low: 'text-gray-500',
};

export function CocDashboard() {
  const chains = useChainsStore((s) => s.chains);
  const rooms = useConnectionStore((s) => s.rooms);
  const { summon, refreshChains, connected } = useRpc();
  const [showSummon, setShowSummon] = useState(false);
  const [goal, setGoal] = useState('');
  const [selectedChain, setSelectedChain] = useState<string | null>(null);

  useEffect(() => {
    if (!connected || rooms.length === 0) return;
    refreshChains(rooms[0]).catch(() => {});
    const interval = setInterval(() => refreshChains(rooms[0]).catch(() => {}), 5000);
    return () => clearInterval(interval);
  }, [connected, rooms, refreshChains]);

  const handleSummon = async () => {
    if (!goal.trim() || rooms.length === 0) return;
    try {
      await summon(goal.trim(), rooms[0]);
      setGoal('');
      setShowSummon(false);
    } catch (err: any) {
      console.error('Summon failed:', err.message);
    }
  };

  const selected = chains.find((c) => c.id === selectedChain);
  const active = chains.filter((c) => c.status === 'open' || c.status === 'running');
  const completed = chains.filter((c) => c.status !== 'open' && c.status !== 'running');

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Chain of Collaboration</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {active.length} active, {completed.length} completed
          </p>
        </div>
        <button
          onClick={() => setShowSummon(true)}
          className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium hover:bg-emerald-500/30 transition-colors"
        >
          + New Summon
        </button>
      </div>

      {/* Summon Modal */}
      {showSummon && (
        <div className="px-6 py-4 border-b border-gray-800 bg-gray-900/50">
          <div className="text-sm font-medium text-gray-300 mb-2">Summon a Chain</div>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Describe the goal for your collaboration chain..."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 resize-none"
            rows={3}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => setShowSummon(false)}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleSummon}
              disabled={!goal.trim()}
              className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Summon
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto flex">
        {/* Chain List */}
        <div className={`${selected ? 'w-1/3' : 'w-full'} border-r border-gray-800 overflow-y-auto`}>
          {chains.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-gray-600">
              No chains yet. Click "New Summon" to start.
            </div>
          ) : (
            <div className="divide-y divide-gray-800/50">
              {chains.map((chain) => {
                const completedSteps = chain.steps.filter(
                  (s) => s.status === 'merged' || s.status === 'reviewed'
                ).length;
                const progress = chain.steps.length > 0 ? (completedSteps / chain.steps.length) * 100 : 0;

                return (
                  <button
                    key={chain.id}
                    onClick={() => setSelectedChain(chain.id === selectedChain ? null : chain.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-800/50 transition-colors ${
                      chain.id === selectedChain ? 'bg-gray-800/50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${STATUS_COLORS[chain.status] || STATUS_COLORS.open}`}>
                        {chain.status}
                      </span>
                      <span className={`text-[10px] ${PRIORITY_COLORS[chain.priority] || ''}`}>
                        {chain.priority}
                      </span>
                    </div>
                    <div className="text-sm text-gray-200 line-clamp-2">{chain.goal}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500">
                        {completedSteps}/{chain.steps.length}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Chain Detail */}
        {selected && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-gray-200">{selected.goal}</h2>
              <div className="text-[10px] text-gray-500 font-mono mt-1">{selected.id}</div>
            </div>

            {/* Steps DAG (simplified linear view) */}
            <div className="space-y-2">
              {selected.steps.map((step, i) => (
                <div
                  key={step.id}
                  className="flex items-start gap-3 px-3 py-2.5 bg-gray-900 rounded-lg border border-gray-800"
                >
                  <div className="flex flex-col items-center mt-1">
                    <div className={`w-3 h-3 rounded-full ${STEP_COLORS[step.status] || 'bg-gray-600'}`} />
                    {i < selected.steps.length - 1 && <div className="w-px h-8 bg-gray-700 mt-1" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-200">{step.title}</span>
                      <span className="text-[10px] text-gray-500 px-1 py-0.5 bg-gray-800 rounded">{step.kind}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                      <span>{step.status}</span>
                      {step.assignee && <span>assigned to {step.assigneeName || step.assignee.slice(0, 12)}...</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
