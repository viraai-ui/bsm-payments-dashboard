import type { Metadata } from 'next'
import PublicPaymentForm from './PublicPaymentForm'

export const metadata: Metadata = { title: 'Payments | BSM India', description: 'View and submit salesman payments securely.', robots: { index: false, follow: false } }
export default function SubmitPaymentPage() { return <PublicPaymentForm /> }
