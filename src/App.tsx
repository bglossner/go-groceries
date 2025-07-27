import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import './App.css';

// Import the generated route tree
import { routeTree } from './routeTree.gen';
import { DebugConsole } from './pages/DebugConsole';
import InstallPWAButton from './components/InstallPWAButton';

// Create a new router instance
const router = createRouter({ routeTree });

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();
const isInstalled = window.matchMedia('(display-mode: standalone)').matches;

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} client={queryClient} />}
      {import.meta.env.DEV && <DebugConsole />}
      {!isInstalled && <InstallPWAButton />}
    </QueryClientProvider>
  );
};

export default App;