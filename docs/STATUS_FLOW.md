# Status Flow

Use this exact operational flow:

1. New Sales Order
2. QR Pending
3. QR Generated
4. QR Printed
5. Wooden Packing Pending, only if required
6. Wooden Packing Completed / Not Required
7. Ready for Packaging
8. Packing Started
9. QR Pasted
10. QC Done
11. Packing Done
12. Media Proof Pending
13. Media Proof Uploaded
14. Vehicle Booking Pending
15. Vehicle Booked
16. Dispatched
17. Closed / Delivered

Every status change must write an audit log with user, timestamp, previous status, new status, and remarks.

## Blocking rules
- Serial generation must happen only on backend.
- QR Printed is required before packaging.
- Wooden Packing Completed or Not Required is required before packaging.
- Packing Done moves machine to Media Proof Pending.
- Media proof requires minimum 2 photos and 1 video.
- Dispatch is blocked if media proof is incomplete unless Admin/Super Admin override with reason.
- Dispatch completion locks dispatch details and starts warranty.
