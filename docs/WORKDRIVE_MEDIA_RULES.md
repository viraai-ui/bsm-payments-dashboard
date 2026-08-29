# WorkDrive Media Rules

## Storage rule
Photos/videos must be stored in Zoho WorkDrive, not Postgres. Database stores only filename, type, size, WorkDrive file/folder IDs, URL, uploader, timestamp, sales order, and machine serial.

## Required media before dispatch
- Minimum 2 photos
- Minimum 1 video
- Optional loading photo later

## Folder structure
BSM Dispatch Proof → FY 2026-2027 → SO-1001 - Customer Name → 262700001 → Photos / Videos / Loading Proof

## Upload approach
Preferred: dashboard upload with direct/chunked WorkDrive upload where safe. Fallback: dashboard creates WorkDrive folder/upload link, user uploads in WorkDrive, dashboard stores folder/file links.

## Dispatch blocking
Dispatch is blocked unless required media exists, unless Admin/Super Admin overrides with reason. Override must create audit log.

## Vercel constraint
Do not proxy large videos through normal Vercel API routes unless technically safe. Avoid storing binary payloads in the database.
