// components/QueryProvider.jsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export default function QueryProvider({ children }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // Cache dữ liệu trong 5 phút
        cacheTime: 10 * 60 * 1000, // Giữ cache trong 10 phút
        refetchOnWindowFocus: false, // Không refetch khi window focus
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}