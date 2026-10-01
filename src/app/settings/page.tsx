import { redirect } from 'next/navigation'
import { DashboardShell } from '@/components/DashboardShell'
import { SettingsClient } from '@/components/SettingsClient'
import { PasswordSettings } from '@/components/PasswordSettings'
import { getSessionUser } from '@/lib/auth'

export default async function SettingsPage() {
  const user = await getSessionUser()
  if (user && !['Admin', 'Accounts', 'Salesperson', 'Spare Part Sales'].includes(user.role)) redirect('/payments')
  return <DashboardShell active="Settings">{user?.role === 'Admin' ? <SettingsClient /> : <PasswordSettings />}</DashboardShell>
}
