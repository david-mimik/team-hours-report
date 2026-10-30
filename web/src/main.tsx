import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@copilotkit/react-core/v2/styles.css';
import './styles.css';
import App from './App';

// CopilotKit's chat themes on a .dark class; follow the OS setting like the report canvas does.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const syncTheme = () => document.documentElement.classList.toggle('dark', darkQuery.matches);
syncTheme();
darkQuery.addEventListener('change', syncTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
