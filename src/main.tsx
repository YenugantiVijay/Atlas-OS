import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProviders } from './app/providers';
import { AppRouter } from './app/router';
import './styles/index.css';
import { PwaStatus } from './components/ui/PwaStatus';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <PwaStatus />
      <AppRouter />
    </AppProviders>
  </React.StrictMode>
);
