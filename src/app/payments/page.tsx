import { DashboardShell } from '@/components/DashboardShell'
import { PaymentsClient } from '@/components/PaymentsClient'
import { getSessionUser, getUserStore } from '@/lib/auth'
import { listPaymentsForUser } from '@/lib/payments'

export const dynamic = 'force-dynamic'

export default async function PaymentsPage() {
  const user = await getSessionUser()
  const payments = user ? await listPaymentsForUser(user) : []
  const salespeople=user?.role==='Admin'?(await getUserStore()).users.filter(u=>u.active&&u.role==='Salesperson').map(u=>({id:u.id,name:u.name,username:u.username})):[]
  return <DashboardShell active="Payments">
    {user ? <PaymentsClient key={`${user.id}:${user.role}`} initialPayments={payments} userRole={user.role} userId={user.id} salespeople={salespeople} /> : null}
  </DashboardShell>
}
