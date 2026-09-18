import { apiError } from '@/lib/api'
import { publicApiHeaders } from '@/lib/public-payment-security'
/** Deprecated in local-only mode. Proofs are submitted in the payment multipart request. */
export async function POST(){return publicApiHeaders(apiError('Direct cloud uploads are disabled in local-only mode',410))}
