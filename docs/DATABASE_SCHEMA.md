# Database Schema Contract

Database: Postgres. ORM: Prisma.

Core tables:
- users
- zoho_sales_orders
- zoho_sales_order_items
- serial_counters
- machine_units
- qr_templates
- print_jobs
- wooden_packing_tasks
- packing_tasks
- media_uploads
- dispatch_bookings
- sync_jobs
- sync_conflicts
- audit_logs
- app_settings

## Hard constraints
- `machine_units.serial_number` unique and immutable.
- `machine_units.qr_token` unique.
- `serial_counters.fy_prefix` unique.
- Voided serials stay in database with void reason.
- Generated serials are never deleted.
- Payload hashes are stored on Zoho orders/items for conflict detection.
- Raw Zoho payloads are stored as JSON for audit/debugging.

## Serial generation transaction
Inside one DB transaction:
1. Determine Indian financial-year prefix.
2. Lock or upsert the `serial_counters` row for that prefix.
3. Increment counter per physical unit.
4. Insert machine unit rows with unique serial numbers.
5. Create QR tokens.
6. Create wooden packing and packing tasks as needed.
7. Write audit logs.

Double-click/idempotency is handled by checking existing machine units for the order/item before creating new rows.
