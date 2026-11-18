import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './router';
import './styles.css';

// Monitoring data refreshes every 10 s (Socket.IO replaced by polling, PLAN [usulan]).
const queryClient = new QueryClient({ defaultOptions: { queries: { refetchInterval: 10_000, staleTime: 5_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
