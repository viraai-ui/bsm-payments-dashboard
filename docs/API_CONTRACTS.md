# API Contracts

## Auth
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

## Zoho sync
- `POST /api/webhooks/zoho/sales-order`
- `POST /api/sync/zoho/sales-orders`
- `GET /api/sync/status`
- `POST /api/sync/retry/:jobId`

## Orders
- `GET /api/orders`
- `GET /api/orders/:id`
- `POST /api/orders/:id/review-conflict`
- `POST /api/orders/:id/resolve-conflict`

## Serial / QR
- `POST /api/orders/:id/generate-serials`
- `POST /api/machine-units/:id/void`
- `GET /api/machine-units/:id`
- `GET /api/machine-units/search`

## QR templates / print
- `GET /api/qr-templates`
- `POST /api/qr-templates`
- `PUT /api/qr-templates/:id`
- `POST /api/print-jobs`
- `GET /api/print-jobs/:id/pdf`

## Operations
- `GET /api/wooden-packing`
- `PUT /api/wooden-packing/:id/status`
- `GET /api/packaging-tv`
- `PUT /api/packing/:id/status`
- `POST /api/media/upload-session`
- `POST /api/media/complete`
- `GET /api/media/:machineUnitId`
- `POST /api/dispatch/book`
- `POST /api/dispatch/complete`

## Public/internal QR route
- `GET /m/:qrToken`

All sensitive endpoints require auth and role checks. QR public route returns limited details unless logged in.
