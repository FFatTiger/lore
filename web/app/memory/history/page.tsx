import React, { Suspense } from 'react';
import MemoryHistoryPage from './MemoryHistoryPage';

export default function Page(): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <MemoryHistoryPage />
    </Suspense>
  );
}
