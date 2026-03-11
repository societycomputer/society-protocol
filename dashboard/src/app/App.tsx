import { Routes, Route } from 'react-router';
import { Sidebar } from './components/Sidebar';
import { NetworkGraph } from './panels/NetworkGraph';
import { BuddyList } from './panels/BuddyList';
import { TransportMonitor } from './panels/TransportMonitor';
import { CocDashboard } from './panels/CocDashboard';
import { FederationManager } from './panels/FederationManager';
import { MissionControl } from './panels/MissionControl';
import { KnowledgeExplorer } from './panels/KnowledgeExplorer';
import { ChatRoom } from './panels/ChatRoom';
import { useSocket } from './hooks/useSocket';

export default function App() {
  // Initialize WebSocket connection
  useSocket();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<NetworkGraph />} />
          <Route path="/chat" element={<ChatRoom />} />
          <Route path="/agents" element={<BuddyList />} />
          <Route path="/transports" element={<TransportMonitor />} />
          <Route path="/chains" element={<CocDashboard />} />
          <Route path="/federations" element={<FederationManager />} />
          <Route path="/missions" element={<MissionControl />} />
          <Route path="/knowledge" element={<KnowledgeExplorer />} />
        </Routes>
      </main>
    </div>
  );
}
