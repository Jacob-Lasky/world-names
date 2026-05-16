import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './dev/handles'; // tree-shaken in production via import.meta.env.DEV guard

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
