import type { AppRole } from './auth'

/** Spare-part sales normally records receipts before a sales order exists. */
export const defaultManualPaymentEntry = (role: AppRole, salesOrderNumber?: string) =>
  role === 'Spare Part Sales' && !salesOrderNumber