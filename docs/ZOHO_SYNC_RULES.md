# Zoho Sync Rules

## Source of truth
Zoho Inventory is source for sales orders, customers, items, line items, quantities, Zoho IDs, invoices, and inventory data. Dashboard is source for generated serial numbers and QR tokens.

## Three sync methods
1. Webhook: `POST /api/webhooks/zoho/sales-order`, validates secret, stores raw event, fetches full order.
2. Scheduled backup sync: every 10–15 minutes, fetch recent/open orders, compare payload hashes.
3. Manual sync: Admin button, returns last sync time, updated count, conflicts, failures.

## Payload hash fields
Customer, delivery date, item IDs, line item IDs, quantity, wooden packing, packing type, dimensions, important custom fields.

## Change handling
- Before QR generation: safe to update dashboard records from Zoho.
- After QR generation: never silently overwrite. Mark `review_required` and create sync conflict.
- Never auto-delete serial numbers.
- Quantity increase can generate extra machine units after Admin review.
- Quantity decrease can void extra units only by Super Admin with reason.

## Serial sync to Zoho
- Dashboard generates serial first.
- Zoho receives serial/package/invoice updates idempotently.
- Zoho sync failure must not block dashboard operations, but must show warning and retry option.
