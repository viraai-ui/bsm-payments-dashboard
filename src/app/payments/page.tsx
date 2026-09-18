import { DashboardShell } from '@/components/DashboardShell'
import { PaymentsClient } from '@/components/PaymentsClient'
import { getSessionUser, getUserStore } from '@/lib/auth'
import { listPaymentsForUser } from '@/lib/payments'

export const dynamic = 'force-dynamic'

export default async function PaymentsPage() {
  const user = await getSessionUser()
  const authed = Boolean(user)
  const payments = user ? await listPaymentsForUser(user) : []
  const salespeople=user?.role==='Admin'?(await getUserStore()).users.filter(u=>u.active&&u.role==='Salesperson').map(u=>({id:u.id,name:u.name,username:u.username})):[]
  return <DashboardShell active="Payments"><PaymentsClient initialPayments={payments} userRole={user?.role || 'Admin'} userId={user?.id || ''} salespeople={salespeople} /></DashboardShell>
}
