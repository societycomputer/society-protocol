import { useState } from 'react';
import { useFederationsStore } from '../stores/federations';
import { useRpc } from '../hooks/useRpc';

const GOVERNANCE_ICONS: Record<string, string> = {
  democracy: 'Vote-based',
  oligarchy: 'Council',
  meritocracy: 'Merit',
  dictatorship: 'Leader',
};

const VISIBILITY_COLORS: Record<string, string> = {
  public: 'bg-emerald-500/20 text-emerald-400',
  private: 'bg-amber-500/20 text-amber-400',
  'invite-only': 'bg-purple-500/20 text-purple-400',
};

export function FederationManager() {
  const federations = useFederationsStore((s) => s.federations);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    visibility: 'public',
    governance: 'democracy',
  });

  const addFederation = useFederationsStore((s) => s.addFederation);
  const { createFederation, refreshFederations } = useRpc();

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    try {
      const fed = await createFederation(form.name, form.description, form.visibility);
      if (fed) {
        addFederation({
          id: fed.id,
          name: fed.name,
          description: fed.description,
          visibility: fed.visibility || form.visibility,
          governance: form.governance,
          memberCount: fed.memberCount || 1,
          onlineCount: fed.onlineCount || 1,
        });
      }
    } catch (err) {
      console.error('Failed to create federation:', err);
    }
    setForm({ name: '', description: '', visibility: 'public', governance: 'democracy' });
    setShowCreate(false);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Federations</h1>
          <p className="text-xs text-gray-500 mt-0.5">{federations.length} federation{federations.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium hover:bg-emerald-500/30 transition-colors"
        >
          + Create Federation
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="px-6 py-4 border-b border-gray-800 bg-gray-900/50 space-y-3">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Federation name..."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Description..."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 resize-none"
            rows={2}
          />
          <div className="flex gap-3">
            <select
              value={form.visibility}
              onChange={(e) => setForm({ ...form, visibility: e.target.value })}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none"
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="invite-only">Invite Only</option>
            </select>
            <select
              value={form.governance}
              onChange={(e) => setForm({ ...form, governance: e.target.value })}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none"
            >
              <option value="democracy">Democracy</option>
              <option value="oligarchy">Oligarchy</option>
              <option value="meritocracy">Meritocracy</option>
              <option value="dictatorship">Dictatorship</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">Cancel</button>
            <button onClick={handleCreate} disabled={!form.name.trim()} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-500 disabled:opacity-50">Create</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {federations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-600">
            <div className="text-4xl mb-4">&#x2606;</div>
            <div className="text-sm">No federations yet</div>
            <div className="text-xs mt-1">Create one to start organizing agents</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {federations.map((fed) => (
              <div key={fed.id} className="px-4 py-4 bg-gray-900 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors cursor-pointer">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${VISIBILITY_COLORS[fed.visibility] || ''}`}>
                    {fed.visibility}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {GOVERNANCE_ICONS[fed.governance] || fed.governance}
                  </span>
                </div>
                <div className="text-sm font-medium text-gray-200">{fed.name}</div>
                {fed.description && <div className="text-xs text-gray-500 mt-1 line-clamp-2">{fed.description}</div>}
                <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
                  <span>{fed.memberCount} members</span>
                  <span>{fed.onlineCount} online</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
