import type { DispatchCategory, OrderLineItem } from '@/types/domain'

const ADHESIVE_SKUS = new Set([
  '7100',
  '7101',
  '7150',
  '7011',
  'KL 25',
  '7130',
  '7120',
  '7340',
  'KL 24',
  '7160',
])

export function normalizeSku(sku: string) {
  return String(sku || '').trim().replace(/\s+/g, ' ').toUpperCase()
}

export function classifyDispatchItem(item: Pick<OrderLineItem, 'sku' | 'itemName'>): DispatchCategory {
  const sku = normalizeSku(item.sku)
  const name = String(item.itemName || '').toLowerCase()
  if (ADHESIVE_SKUS.has(sku)) return 'adhesive'
  if (name.includes('freight') || name.includes('transportation charges')) return 'freight'
  return 'machine'
}

export function isMachineLineItem(item: Pick<OrderLineItem, 'sku' | 'itemName' | 'dispatchCategory'>) {
  return (item.dispatchCategory || classifyDispatchItem(item)) === 'machine'
}

export function dispatchCategoryLabel(category?: DispatchCategory) {
  return category === 'adhesive' ? 'Adhesive' : category === 'freight' ? 'Freight' : category === 'other' ? 'Other' : 'Machine'
}
