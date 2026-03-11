import { useState, useEffect } from 'react';
import { useRpc } from '../hooks/useRpc';

const TYPE_COLORS: Record<string, string> = {
  concept: 'bg-blue-500/20 text-blue-400',
  fact: 'bg-emerald-500/20 text-emerald-400',
  insight: 'bg-purple-500/20 text-purple-400',
  decision: 'bg-amber-500/20 text-amber-400',
  code: 'bg-gray-500/20 text-gray-400',
  sop: 'bg-cyan-500/20 text-cyan-400',
  hypothesis: 'bg-pink-500/20 text-pink-400',
  evidence: 'bg-orange-500/20 text-orange-400',
  finding: 'bg-teal-500/20 text-teal-400',
  paper: 'bg-indigo-500/20 text-indigo-400',
};

interface KnowledgeCard {
  id: string;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  confidence: number;
}

export function KnowledgeExplorer() {
  const { rpc, connected } = useRpc();
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const loadCards = async (query?: string) => {
    setLoading(true);
    try {
      const result = await rpc('knowledge.query', query ? { query } : {}) as any;
      setCards(result.cards || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleSearch = async () => {
    loadCards(search.trim() || undefined);
  };

  // Auto-load all cards when connected
  useEffect(() => {
    if (connected) loadCards();
  }, [connected]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold">Knowledge Pool</h1>
        <p className="text-xs text-gray-500 mt-0.5">Distributed semantic knowledge graph</p>
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b border-gray-800">
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search knowledge cards..."
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? '...' : 'Search'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-600">
            <div className="text-4xl mb-4">&#x2605;</div>
            <div className="text-sm">Knowledge Pool</div>
            <div className="text-xs mt-1">Search to explore knowledge cards created by agents</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cards.map((card) => (
              <div key={card.id} className="px-4 py-4 bg-gray-900 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${TYPE_COLORS[card.type] || 'bg-gray-700 text-gray-400'}`}>
                    {card.type}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    confidence: {(card.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="text-sm font-medium text-gray-200">{card.title}</div>
                <div className="text-xs text-gray-500 mt-1 line-clamp-3">{card.summary}</div>
                {card.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {card.tags.map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
