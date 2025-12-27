// app/tab-layout.jsx
'use client';

import Header from '@/components/Header';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

const tabMap = {
  dex: 'dex',
  etf: 'etf',
  cluster: 'cluster',
  graph: 'graph',        // treemap
  explorer: 'explorer',
  // thêm các tab khác nếu cần
};

export default function TabLayout({ children, initialTab }) {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState(initialTab);

  // Cập nhật activeTab nếu URL thay đổi (ví dụ từ link ngoài)
  // Không bắt buộc nhưng tốt cho consistency
  // useEffect(() => {
  //   const tab = tabMap[initialTab];
  //   if (tab) setActiveTab(tab);
  // }, [initialTab]);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-black to-gray-900 text-white">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        handleSignOut={() => {}} // không cần sign out ở standalone
        selectedAddress={searchParams.get('address') || undefined}
      />
      <main className="flex-1"> {/* Đẩy nội dung xuống đúng bằng chiều cao Header */}
        {children}
      </main>
    </div>
  );
}