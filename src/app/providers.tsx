'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export default function Providers({ children }: { children: React.ReactNode }) {
  // useState로 감싸지 않으면 리렌더마다 새 QueryClient가 만들어져 캐시가 날아간다.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 상가 데이터는 분기 스냅샷이라 세션 중에 바뀌지 않는다.
            // 같은 자리를 다시 찍었을 때 서버를 또 부를 이유가 없다.
            staleTime: Infinity,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
