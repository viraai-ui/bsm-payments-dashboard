import { DashboardShell } from '@/components/DashboardShell'
import { PaymentsClient } from '@/components/PaymentsClient'
import { getSessionUser, getUserStore } from '@/lib/auth'
import { paymentReadModelForUserFresh } from '@/lib/payments'

export const dynamic = 'force-dynamic'

export default async function PaymentsPage() {
  const user = await getSessionUser()
  const model = user ? await paymentReadModelForUserFresh(user) : {payments:[],pendingOrders:[]}
  const salespeople=user&&['Admin','Accounts','Viewer'].includes(user.role)?(await getUserStore()).users.filter(u=>u.active&&u.role==='Salesperson').map(u=>({id:u.id,name:u.name,username:u.username})):[]
  return <DashboardShell active="Payments">
    {user ? <PaymentsClient key={`${user.id}:${user.role}`} initialPayments={model.payments} initialPendingOrders={model.pendingOrders} userRole={user.role} userId={user.id} salespeople={salespeople} /> : null}
  </DashboardShell>
}
