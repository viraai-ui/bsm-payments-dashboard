import { createHash } from 'node:crypto'

export const MUTABLE_PAYMENT_FIELDS = new Set(['salesOrderId','salesOrderNumber','orderTotal','salesOrderDate','customerName'])
export const normalizeSalesOrderNumber = value => String(value ?? '').trim().toUpperCase()
export const normalizeCustomer = value => String(value ?? '').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-IN')
const stable = value => JSON.stringify(value)
const sum = values => values.reduce((total,value)=>total+Number(value||0),0)
const date = value => String(value ?? '').slice(0,10)
const total = order => Number(order.orderTotal??order.total)

function validateReviewedMapping(mapping, store, orders) {
  if(!mapping || !Array.isArray(mapping.associations) || !Array.isArray(mapping.customerCanonicalizations))throw new Error('Reviewed mapping is invalid')
  if(mapping.associations.length!==8)throw new Error(`Reviewed mapping must contain exactly 8 associations, got ${mapping.associations.length}`)
  const payments=new Map(store.payments.map(payment=>[payment.id,payment])), byId=new Map(orders.map(order=>[String(order.id),order]))
  const seen=new Set()
  for(const item of mapping.associations){
    if(!item.paymentId||seen.has(item.paymentId))throw new Error(`Duplicate/empty reviewed payment ID: ${item.paymentId}`);seen.add(item.paymentId)
    if(!item.evidence?.uniqueSameDayOrder||!item.evidence?.exactAmountEqualsOrderTotal||!item.evidence?.customerLegalNameMatch)throw new Error(`Incomplete reviewed evidence for ${item.paymentId}`)
    const payment=payments.get(item.paymentId),order=byId.get(String(item.salesOrderId))
    if(!payment)throw new Error(`Reviewed payment missing: ${item.paymentId}`)
    const stillUnlinked=!payment.salesOrderNumber&&!payment.salesOrderId
    const alreadyApplied=String(payment.salesOrderId)===String(item.salesOrderId)&&String(payment.salesOrderNumber)===item.salesOrderNumber&&payment.customerName===item.customerName&&Number(payment.orderTotal)===Number(item.orderTotal)&&date(payment.salesOrderDate)===item.salesOrderDate
    if(!stillUnlinked&&!alreadyApplied)throw new Error(`Reviewed payment linkage is neither original nor already applied: ${item.paymentId}`)
    if(![item.paymentCustomerName,item.customerName].includes(payment.customerName)||Number(payment.paymentAmount)!==Number(item.paymentAmount)||date(payment.paymentDate)!==item.paymentDate)throw new Error(`Reviewed payment fields changed: ${item.paymentId}`)
    if(!order)throw new Error(`Reviewed Zoho order missing: ${item.salesOrderId}`)
    const exact=String(order.id)===String(item.salesOrderId)&&String(order.salesOrderNumber).trim()===item.salesOrderNumber&&date(order.orderDate)===item.salesOrderDate&&total(order)===Number(item.orderTotal)&&String(order.currency).trim()===item.currency&&String(order.customerName).trim()===item.customerName
    if(!exact)throw new Error(`Live Zoho order differs from reviewed ID/number/date/total/currency/customer: ${item.paymentId}`)
    if(Number(payment.paymentAmount)!==total(order)||date(payment.paymentDate)!==date(order.orderDate))throw new Error(`Live amount/date evidence failed: ${item.paymentId}`)
    const sameDayAmount=orders.filter(candidate=>date(candidate.orderDate)===item.salesOrderDate&&total(candidate)===Number(item.orderTotal))
    if(sameDayAmount.length!==1||String(sameDayAmount[0].id)!==String(item.salesOrderId))throw new Error(`Unique same-day exact-total evidence failed: ${item.paymentId}`)
  }
  if(mapping.customerCanonicalizations.length!==2)throw new Error('Reviewed mapping must contain exactly 2 customer canonicalizations')
  for(const item of mapping.customerCanonicalizations){
    const payment=payments.get(item.paymentId),order=byId.get(String(item.salesOrderId))
    if(!payment||!order)throw new Error(`Canonicalization payment/order missing: ${item.paymentId}`)
    if(normalizeSalesOrderNumber(payment.salesOrderNumber)!==normalizeSalesOrderNumber(item.salesOrderNumber)||![item.storedCustomerName,item.customerName].includes(payment.customerName))throw new Error(`Canonicalization source changed: ${item.paymentId}`)
    if(String(order.id)!==String(item.salesOrderId)||String(order.salesOrderNumber).trim()!==item.salesOrderNumber||String(order.customerName).trim()!==item.customerName)throw new Error(`Canonicalization live immutable order mismatch: ${item.paymentId}`)
  }
}

export function buildBackfill(store, orders, reviewedMapping) {
  if (!store || !Array.isArray(store.payments)) throw new Error('payments.json must contain a payments array')
  if (!Array.isArray(orders)) throw new Error('Zoho orders must be an array')
  if(reviewedMapping)validateReviewedMapping(reviewedMapping,store,orders)
  const byNumber = new Map(), duplicateOrderNumbers=[]
  for (const order of orders) {
    const key=normalizeSalesOrderNumber(order.salesOrderNumber)
    if(!key||!String(order.id||'').trim()||!Number.isFinite(order.orderTotal??order.total))continue
    if(byNumber.has(key)){duplicateOrderNumbers.push(key);byNumber.set(key,null)}else byNumber.set(key,order)
  }
  const original=structuredClone(store), output=structuredClone(store)
  const report={payments:store.payments.length,zohoOrders:orders.length,candidates:0,linked:0,reviewedLinked:0,totalLinked:0,alreadyComplete:0,unlinkedWithoutNumber:0,numberedUnmatched:0,ambiguous:0,customerCanonicalized:0,customerConflicts:[],reviewedCustomerConflictCanonicalizations:[],aggregateConflicts:[],duplicateOrderNumbers:[...new Set(duplicateOrderNumbers)].sort(),changed:0}
  if(reviewedMapping){
    const byPayment=new Map(output.payments.map(payment=>[payment.id,payment]))
    for(const item of reviewedMapping.associations){const payment=byPayment.get(item.paymentId);payment.salesOrderId=item.salesOrderId;payment.salesOrderNumber=item.salesOrderNumber;payment.orderTotal=item.orderTotal;payment.salesOrderDate=item.salesOrderDate;payment.customerName=item.customerName;report.reviewedLinked++}
  }
  const canonicalizations=new Map((reviewedMapping?.customerCanonicalizations||[]).map(item=>[item.paymentId,item]))
  for(let i=0;i<output.payments.length;i++){
    const payment=output.payments[i],key=normalizeSalesOrderNumber(payment.salesOrderNumber)
    if(!key){report.unlinkedWithoutNumber++;continue}
    report.candidates++
    const order=byNumber.get(key)
    if(order===null){report.ambiguous++;continue}
    if(!order){report.numberedUnmatched++;continue}
    const before=stable(payment), customerExact=normalizeCustomer(payment.customerName)===normalizeCustomer(order.customerName),reviewed=canonicalizations.get(payment.id)
    payment.salesOrderId=String(order.id);payment.salesOrderNumber=String(order.salesOrderNumber).trim();payment.orderTotal=total(order);payment.salesOrderDate=date(order.orderDate)
    if(reviewed){
      if(String(order.id)!==String(reviewed.salesOrderId))throw new Error(`Canonicalization resolved to wrong order: ${payment.id}`)
      payment.customerName=String(order.customerName).trim();report.customerCanonicalized++;report.reviewedCustomerConflictCanonicalizations.push({paymentId:payment.id,salesOrderId:payment.salesOrderId,salesOrderNumber:payment.salesOrderNumber,from:original.payments[i].customerName,to:payment.customerName})
    } else if(customerExact&&order.customerName&&payment.customerName!==order.customerName){payment.customerName=String(order.customerName).trim();report.customerCanonicalized++}
    else if(!customerExact)report.customerConflicts.push({paymentId:payment.id,salesOrderNumber:payment.salesOrderNumber,paymentCustomer:original.payments[i].customerName,zohoCustomer:order.customerName})
    if(before===stable(payment))report.alreadyComplete++;else{report.changed++;report.linked++}
  }
  report.totalLinked=output.payments.filter(payment=>payment.salesOrderId&&payment.salesOrderNumber).length
  const groups=new Map()
  for(const payment of output.payments){const key=normalizeSalesOrderNumber(payment.salesOrderNumber);if(key&&byNumber.get(key)){const values=groups.get(key)||[];values.push(payment);groups.set(key,values)}}
  for(const [key,payments] of groups){const order=byNumber.get(key),paid=sum(payments.filter(p=>p.status!=='Void').map(p=>p.paymentAmount));if(paid>total(order))report.aggregateConflicts.push({salesOrderNumber:order.salesOrderNumber,paymentTotal:paid,orderTotal:total(order),paymentIds:payments.map(p=>p.id)})}
  assertSafeMutation(original,output)
  return {output,report}
}

export function assertSafeMutation(before,after){
  if(before.payments.length!==after.payments.length)throw new Error('Payment count changed')
  for(let i=0;i<before.payments.length;i++){
    if(before.payments[i].id!==after.payments[i].id)throw new Error(`Payment identity/order changed at index ${i}`)
    const fields=new Set([...Object.keys(before.payments[i]),...Object.keys(after.payments[i])])
    for(const field of fields)if(!MUTABLE_PAYMENT_FIELDS.has(field)&&stable(before.payments[i][field])!==stable(after.payments[i][field]))throw new Error(`Protected field ${field} changed for ${before.payments[i].id}`)
  }
}
export const contentDigest = bytes => createHash('sha256').update(bytes).digest('hex')
