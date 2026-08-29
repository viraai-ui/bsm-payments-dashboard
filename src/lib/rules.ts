export function getFinancialYearPrefix(date = new Date()) {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const startYear = month >= 4 ? year : year - 1
  return `${String(startYear).slice(-2)}${String(startYear + 1).slice(-2)}`
}

export function formatSerial(prefix: string, number: number) {
  return `${prefix}${String(number).padStart(5, '0')}`
}

export function warrantyEndDate(dispatchDate: Date, months: number) {
  const end = new Date(dispatchDate)
  end.setMonth(end.getMonth() + months)
  end.setDate(end.getDate() - 1)
  return end
}

export function meaningfulZohoHashInput(payload: Record<string, unknown>) {
  return {
    customer: payload.customer,
    deliveryDate: payload.deliveryDate,
    items: payload.items,
    woodenPacking: payload.woodenPacking,
    customFields: payload.customFields,
  }
}
