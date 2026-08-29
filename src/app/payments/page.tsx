import { DashboardShell } from '@/components/DashboardShell'
import { PaymentsClient } from '@/components/PaymentsClient'
import { getSessionUser } from '@/lib/auth'
import { listPayments } from '@/lib/payments'

export const dynamic = 'force-dynamic'

export default async function PaymentsPage() {
  const user = await getSessionUser()
  const authed = user?.role === 'Admin' || user?.role === 'Accounts'
  const payments = authed ? await listPayments() : []
  return <DashboardShell active="Payments"><PaymentsClient initialPayments={payments} userRole={user?.role || 'Admin'} /></DashboardShell>
}
