import { WorldMap } from './components/WorldMap';
import { DetailPanel } from './components/DetailPanel';
import './App.css';

export default function App() {

  return (
    <div className="app">
      <header className="app-header">
        <h1>World Names</h1>
        <p>Click a country to see what it calls itself — and how the rest of the world hears that name.</p>
      </header>
      <main className="app-main">
        <WorldMap />
        <DetailPanel />
      </main>
    </div>
  );
}
