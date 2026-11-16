import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerAccess } from './OwnerAccess';
import '@/styles/index.css';
import './owner.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}><OwnerAccess /></QueryClientProvider>,
);
