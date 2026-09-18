# Payments storage and integration safety

This checkout is intentionally local-only.

- Set `APP_LOCAL_ONLY=true` for a production-mode local preview. A real production deployment must provide `AUTH_SECRET`; without either condition authentication fails closed.
- Payments, audit events, users, notifications, the payment-order index, and proof bytes are durable files under `data/`. JSON writes use process-local mutation locks and atomic rename. Missing files may initialize empty; malformed/unreadable files are fatal and never silently treated as empty.
- `data/payment-order-index.json` is the authoritative payment-only order fixture. Refresh reloads that file. The adapter does not import Zoho, dispatch workflows, or GitHub persistence and performs no network call.
- Proofs are accepted by multipart request, checked for count, size, declared MIME and magic bytes, and stored under `data/uploads/payment-proofs`. Serving resolves a payment and attachment index; clients cannot submit filesystem keys.
- Public history and proofs require the per-payment capability retained by the submitting browser. Public deletion requires that same payment capability and exact `Pending` state.
- Cloud upload target routes are disabled. Push delivery is not invoked by public submission. Do not enable the legacy R2/Zoho/GitHub modules without replacing local adapters and adding a transactional production database/object-store implementation.
