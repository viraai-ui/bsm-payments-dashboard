export type InteraktTemplatePayload = {
  phone: string
  templateName: string
  bodyValues: string[]
  countryCode?: string
  callbackData?: string
}

function cleanPhone(raw: string) {
  return raw.replace(/[^0-9]/g, '')
}

export function interaktConfigured() {
  return Boolean(process.env.INTERAKT_API_KEY && process.env.INTERAKT_DISPATCH_CUSTOMER_TEMPLATE && process.env.INTERAKT_DISPATCH_SALESPERSON_TEMPLATE)
}

export async function sendInteraktTemplate(input: InteraktTemplatePayload) {
  const apiKey = process.env.INTERAKT_API_KEY
  if (!apiKey) throw new Error('Interakt API key is not configured')
  const digits = cleanPhone(input.phone)
  if (!digits) throw new Error('WhatsApp phone number is missing')
  const countryCode = input.countryCode || '+91'
  const localPhone = digits.length > 10 && digits.startsWith('91') ? digits.slice(2) : digits
  const body = {
    countryCode,
    phoneNumber: localPhone,
    callbackData: input.callbackData || 'bsm-dispatch',
    type: 'Template',
    template: {
      name: input.templateName,
      languageCode: process.env.INTERAKT_TEMPLATE_LANGUAGE || 'en',
      bodyValues: input.bodyValues,
    },
  }
  const response = await fetch(process.env.INTERAKT_API_URL || 'https://api.interakt.ai/v1/public/message/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok || json.result === false) throw new Error(json.message || `Interakt send failed (${response.status})`)
  return json
}
