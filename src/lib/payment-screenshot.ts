const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
}

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
}

/** Mobile Safari and Android webviews can provide an empty or non-standard File.type. */
export function paymentScreenshotType(name: string, declaredType: string) {
  const type = declaredType.trim().toLowerCase().split(';', 1)[0]
  const extension = name.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || ''
  const mimeFromType = MIME_TO_EXTENSION[type] ? (type === 'image/jpg' ? 'image/jpeg' : type) : ''
  const mimeFromName = EXTENSION_TO_MIME[extension] || ''
  if (mimeFromType && mimeFromName && mimeFromType !== mimeFromName) return null
  const mimeType = mimeFromType || mimeFromName
  if (!mimeType) return null
  return { mimeType, extension: MIME_TO_EXTENSION[mimeType] }
}

export const PUBLIC_PAYMENT_SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024
export const INTERNAL_PAYMENT_SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024
export const PAYMENT_PROOF_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'] as const

/** Client-side counterpart to the upload-target validation. */
export function normalizePaymentScreenshotFile(file: File) {
  if (!file.size) throw new Error('Payment proof is empty.')
  if (file.size > PUBLIC_PAYMENT_SCREENSHOT_MAX_BYTES) throw new Error('Payment proof must be no larger than 10 MB.')
  const normalized = paymentScreenshotType(file.name, file.type)
  if (!normalized) throw new Error('Choose a JPEG, PNG, WebP, HEIC, HEIF or PDF file.')
  return file.type === normalized.mimeType ? file : new File([file], file.name, { type: normalized.mimeType, lastModified: file.lastModified })
}

/** Re-encoding via canvas applies EXIF orientation and strips embedded metadata. */
export async function compressPaymentScreenshot(file:File){
  const normalized=normalizePaymentScreenshotFile(file)
  if(!['image/jpeg','image/png','image/webp'].includes(normalized.type))return normalized
  try{const bitmap=await createImageBitmap(normalized,{imageOrientation:'from-image'}),scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));if(scale===1&&normalized.type==='image/webp')return normalized
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const context=canvas.getContext('2d');if(!context)throw new Error('Image compression unavailable');context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',.8));if(!blob)throw new Error('Image compression failed');if(blob.size>=normalized.size)return normalized;return new File([blob],`${normalized.name.replace(/\.[^.]+$/,'')||'payment-proof'}.webp`,{type:'image/webp',lastModified:normalized.lastModified})
  }catch{return normalized}
}
