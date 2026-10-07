import { DashboardShell } from '@/components/DashboardShell'
import { AdminOverviewClient } from '@/components/AdminOverviewClient'
import { SalespersonOverviewClient } from '@/components/SalespersonOverviewClient'
import { getSessionUser } from '@/lib/auth'
import { paymentReadModelForUserFresh } from '@/lib/payments'
import { redirect } from 'next/navigation'
export const dynamic='force-dynamic'
export default async function OverviewPage(){
 const user=await getSessionUser()
 if(!user)redirect('/payments')
 if(user.role==='Salesperson'||user.role==='Spare Part Sales')return <DashboardShell active="Overview"><SalespersonOverviewClient/></DashboardShell>
 if(user.role!=='Admin')redirect('/payments')
 // Admin's server-authorised read model is deliberately computed before any UI
 // filtering; overview totals therefore always represent the whole organisation.
 const model=await paymentReadModelForUserFresh(user)
 return <DashboardShell active="Overview"><AdminOverviewClient payments={model.payments} pendingOrders={model.pendingOrders}/></DashboardShell>
}
