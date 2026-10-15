import { db, API, now, uid, hash, fail, run, pageSchema, date, enums, authenticate, pget, photoList, propOut, guestOut, reservationOut, reservationCreate } from "../lib/shared.js";
import { z } from "zod";

export default function register(app) {
app.get(API + "/reservations", authenticate, async (req, res) => {
  const pg = pageSchema.safeParse(req.query);
  if (!pg.success)
    return fail(res, 400, "VALIDATION_ERROR", "Invalid pagination");
  const { page, pageSize } = pg.data,
    q = (req.query.q || "").toLowerCase(),
    status = req.query.status || "",
    from = req.query.from || "0001-01-01",
    to = req.query.to || "9999-12-31";
  const where = `r.partner_id=? AND (?='' OR r.status=?) AND r.check_in<=? AND r.check_out>=? AND (?='' OR lower(g.name) LIKE ? OR lower(r.reference) LIKE ?)`;
  const args = [
    req.partnerId,
    status,
    status,
    to,
    from,
    q,
    "%" + q + "%",
    "%" + q + "%",
  ];
  const rows = await db
    .prepare(
      `SELECT r.*,g.name guest_name,g.contact guest_contact,p.name property_name FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN properties p ON p.id=r.property_id WHERE ${where} ORDER BY r.check_in DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize);
  const total = (await db
    .prepare(
      `SELECT count(*) n FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE ${where}`,
    )
    .get(...args)).n;
  res.json({ items: await Promise.all(rows.map(reservationOut)), page, pageSize, total });
});
const reservationBody = z.object({
  propertyId: z.string().uuid(),
  guest: z.object({ name: z.string().min(2), contact: z.string().min(5) }),
  checkIn: date,
  checkOut: date,
  guestCount: z.number().int().positive(),
  paymentMethod: z.enum(enums.methods),
  invoiceRequested: z.boolean().default(false),
  channel: z.enum(enums.channels).default("in_person"),
});
async function createHandler(res, data, partnerId, status = "confirmed") {
  try {
    const id = await reservationCreate({ ...data, partnerId, status });
    return res.status(201).json(await reservationOut({ id }));
  } catch (e) {
    return fail(res, e.status || 400, e.code || "RESERVATION_ERROR", e.message);
  }
}
app.post(API + "/reservations", authenticate, async (req, res) =>
  run(res, reservationBody, async (d) => createHandler(res, d, req.partnerId)),
);
app.get(API + "/reservations/:id", authenticate, async (req, res) => {
  const r = await db
    .prepare("SELECT id FROM reservations WHERE id=? AND partner_id=?")
    .get(req.params.id, req.partnerId);
  return r
    ? res.json(await reservationOut(r))
    : fail(res, 404, "NOT_FOUND", "Reservation not found");
});
app.patch(API + "/reservations/:id/status", authenticate, async (req, res) => {
  const schema = z.object({
    status: z.enum(enums.reservation),
    cancellationReason: z.string().nullable().optional(),
  });
  return run(res, schema, async (d) => {
    const r = await db
      .prepare("SELECT * FROM reservations WHERE id=? AND partner_id=?")
      .get(req.params.id, req.partnerId);
    if (!r) return fail(res, 404, "NOT_FOUND", "Reservation not found");
    const allowed = {
      pending: ["confirmed", "cancelled"],
      confirmed: ["checked_in", "cancelled"],
      checked_in: ["completed", "cancelled"],
      completed: [],
      cancelled: [],
    };
    if (!allowed[r.status].includes(d.status))
      return fail(
        res,
        409,
        "INVALID_TRANSITION",
        `Cannot change ${r.status} to ${d.status}`,
      );
    if (d.status === "cancelled" && !d.cancellationReason)
      return fail(
        res,
        400,
        "VALIDATION_ERROR",
        "cancellationReason is required for cancellation",
      );
    await db.prepare(
      "UPDATE reservations SET status=?,cancellation_reason=?,updated_at=? WHERE id=?",
    ).run(d.status, d.cancellationReason || null, now(), r.id);
    return res.json(await reservationOut({ id: r.id }));
  });
});
}
