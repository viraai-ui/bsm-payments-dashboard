import { apiError, apiOk } from '@/lib/api'
import { removePaymentNotifications } from '@/lib/payment-notifications'
import { deletePendingPublicPayment, listPayments, paymentAttachments } from '@/lib/payments'
import { deletePaymentProofs, deleteProofAttachments } from '@/lib/local-payment-proofs'
import { checkRateLimit, publicApiHeaders, strictSameOrigin, verifyPaymentDeleteCapability } from '@/lib/public-payment-security'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){
 if(!strictSameOrigin(request))return publicApiHeaders(apiError('Invalid request origin',403));if(!(await checkRateLimit(request,'public-payment-delete',20)).allowed)return publicApiHeaders(apiError('Too many requests',429))
 const{id}=await context.params;if(!/^payment-[0-9a-f-]{36}$/i.test(id))return publicApiHeaders(apiError('Invalid payment ID',400));const capability=(request.headers.get('x-payment-delete-token')||'').trim()
 try{const payment=(await listPayments()).find(p=>p.id===id);if(!payment)return publicApiHeaders(apiOk({deleted:true,alreadyDeleted:true}));if(!verifyPaymentDeleteCapability(capability,payment.publicDeleteTokenHash))return publicApiHeaders(apiError('This device is not authorised to delete that payment',403));if(payment.status!=='Pending')return publicApiHeaders(apiError('Only an exact Pending submission can be deleted',409));const result=await deletePendingPublicPayment(id);if(result.outcome!=='deleted')return publicApiHeaders(apiError('Payment is no longer Pending',409));await Promise.all([deletePaymentProofs(id),deleteProofAttachments(paymentAttachments(payment))]);await removePaymentNotifications(id);return publicApiHeaders(apiOk({deleted:true}))}catch(e){return publicApiHeaders(apiError(e instanceof Error?e.message:'Could not delete payment',500))}
}
