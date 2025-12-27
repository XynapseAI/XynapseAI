// app/profile/page.jsx
import ProfileTab from '@/components/ProfileTab';
import TabLayout from '../tab-layout';

export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  return (
    <TabLayout initialTab="profile">
      <ProfileTab />
    </TabLayout>
  );
}