export const PAYMENT_MODES = ['Bank Transfer', 'UPI', 'Cash', 'Credit Card', 'Debit Card', 'Other'] as const
export type PaymentMode = typeof PAYMENT_MODES[number]
export const PAYMENT_STATUSES = ['Unauthorised', 'Pending', 'Payment Received', 'Void'] as const
export type PaymentStatus = typeof PAYMENT_STATUSES[number]
export const MAX_CUSTOMER_LENGTH = 120
export const MAX_REMARKS_LENGTH = 500
export const MAX_PAYMENT_AMOUNT = 9_999_999_999.99

/** Parse user-entered rupees exactly once into integer paise. */
export function parsePaymentAmountPaise(value: unknown) {
  const text = String(value ?? '').trim()
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) return null
  const paise = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'))
  return paise > 0 && paise <= Math.round(MAX_PAYMENT_AMOUNT * 100) ? paise : null
}

export function cleanCustomer(value: unknown) {
  const customer = String(value ?? '').trim().replace(/\s+/g, ' ')
  return customer && customer.length <= MAX_CUSTOMER_LENGTH && !/[\u0000-\u001f\u007f-\u009f<>]/u.test(customer) ? customer : null
}
export function parsePaymentAmount(value: unknown) {
  const paise = parsePaymentAmountPaise(value)
  return paise === null ? null : paise / 100
}
export function isPaymentMode(value: unknown): value is PaymentMode { return PAYMENT_MODES.includes(value as PaymentMode) }
export function cleanRemarks(value: unknown) { const text=String(value??'').trim(); return text.length<=MAX_REMARKS_LENGTH?text:null }
