import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './team-time.css';
import { TeamTime } from './TeamTime';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TeamTime />
  </StrictMode>,
);
