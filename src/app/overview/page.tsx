import { DashboardShell } from '@/components/DashboardShell'
import { SalespersonOverviewClient } from '@/components/SalespersonOverviewClient'
export const dynamic='force-dynamic'
export default function OverviewPage(){return <DashboardShell active="Overview"><SalespersonOverviewClient/></DashboardShell>}
