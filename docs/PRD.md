# BSM Dispatch Dashboard PRD

## Goal
Build a production-ready internal dashboard for BSM India / Build Scale Manufacture Pvt Ltd on top of Zoho Inventory. It is not a full ERP. It manages the operational chain: Zoho Sales Order → Serial Number → QR Label → Wooden Packing → Packaging TV View → Media Proof → Vehicle Booking → Dispatch → Warranty → Machine Passport Lookup.

## Source of truth
- Zoho Inventory: sales orders, customers, items, quantities, line items, invoices/inventory where available.
- Dashboard: serials, QR, machine passport, packing, media proof links, vehicle details, warranty, audit trail.
- Zoho WorkDrive: heavy photos/videos. Database stores only metadata and links.

## V1 modules
1. Auth and roles: Super Admin, Admin, Packaging Team, Dispatch Team, Viewer.
2. Orders: synced Zoho order list, order detail, line item quantity split.
3. Serial + QR: backend-only serial generation, QR token, label preview/print history.
4. Wooden packing: automatic task if line item requires it.
5. Packaging TV: large simple cards and packing status buttons.
6. Media proof: 2 photos + 1 video required before dispatch; WorkDrive metadata storage.
7. Vehicle / Dispatch: manual vehicle booking and dispatch completion.
8. Warranty: starts on dispatch date; default configurable months.
9. Machine Passport: permanent searchable record.
10. Sync Monitor and Audit Logs.

## Critical acceptance criteria
- Quantity N creates N machine units.
- No duplicate serials under concurrent requests.
- Zoho changes after QR generation create Review Required, never silent overwrite.
- QR opens `/m/:qrToken` Machine Passport route.
- Dispatch is blocked until media proof is complete unless admin override with reason.
- Photos/videos are not stored in Postgres.
- Role permissions prevent staff mistakes.
