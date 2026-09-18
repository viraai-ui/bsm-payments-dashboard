import { redirect } from 'next/navigation'
import { DashboardShell } from '@/components/DashboardShell'
import { SettingsClient } from '@/components/SettingsClient'
import { getSessionUser } from '@/lib/auth'

export default async function SettingsPage() {
  const user = await getSessionUser()
  if (user && user.role !== 'Admin') redirect('/payments')
  return <DashboardShell active="Settings"><SettingsClient /></DashboardShell>
}
