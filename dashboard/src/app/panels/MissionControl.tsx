import { useEffect } from 'react';
import { useMissionsStore } from '../stores/missions';
import { useConnectionStore } from '../stores/connection';
import { useRpc } from '../hooks/useRpc';

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  waiting_capacity: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  paused: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  stopped: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
};

export function MissionControl() {
  const missions = useMissionsStore((s) => s.missions);
  const rooms = useConnectionStore((s) => s.rooms);
  const { refreshMissions, stopMission, connected } = useRpc();

  useEffect(() => {
    if (!connected || rooms.length === 0) return;
    refreshMissions(rooms[0]).catch(() => {});
    const interval = setInterval(() => refreshMissions(rooms[0]).catch(() => {}), 5000);
    return () => clearInterval(interval);
  }, [connected, rooms, refreshMissions]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold">Mission Control</h1>
        <p className="text-xs text-gray-500 mt-0.5">{missions.length} mission{missions.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {missions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-600">
            <div className="text-4xl mb-4">&#x2691;</div>
            <div className="text-sm">No active missions</div>
            <div className="text-xs mt-1">Missions run proactive agent swarms</div>
          </div>
        ) : (
          <div className="space-y-3">
            {missions.map((mission) => (
              <div key={mission.id} className="px-4 py-4 bg-gray-900 rounded-lg border border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${STATUS_COLORS[mission.status] || STATUS_COLORS.stopped}`}>
                    {mission.status}
                  </span>
                  <div className="flex gap-1">
                    {mission.status === 'running' && (
                      <button
                        onClick={() => stopMission(mission.id, 'Stopped from dashboard')}
                        className="px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/10 rounded"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-sm text-gray-200">{mission.goal}</div>
                <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
                  <span>{mission.chainCount} chains</span>
                  <span>{mission.workerCount} workers</span>
                  <span className="font-mono">{mission.id.slice(0, 12)}...</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
