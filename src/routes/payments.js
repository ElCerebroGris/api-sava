import { db, API, now, uid, hash, fail, run, pageSchema, date, enums, authenticate, pget, photoList, propOut, guestOut, reservationOut, reservationCreate } from "../lib/shared.js";

export default function register(app) {
app.get(API + "/payments", authenticate, async (req, res) => {
  const pg = pageSchema.safeParse(req.query);
  if (!pg.success)
    return fail(res, 400, "VALIDATION_ERROR", "Invalid pagination");
  const { page, pageSize } = pg.data,
    st = req.query.status || "",
    from = req.query.from || "0001-01-01",
    to = req.query.to || "9999";
  const rows = await db
    .prepare(
      "SELECT pay.*,r.id reservation_id,g.name guest_name,p.name property_name FROM payments pay JOIN reservations r ON r.id=pay.reservation_id JOIN guests g ON g.id=r.guest_id JOIN properties p ON p.id=r.property_id WHERE pay.partner_id=? AND (?='' OR pay.status=?) AND pay.date>=? AND pay.date<=? ORDER BY pay.date DESC LIMIT ? OFFSET ?",
    )
    .all(req.partnerId, st, st, from, to, pageSize, (page - 1) * pageSize);
  const total = (await db
    .prepare(
      "SELECT count(*) n FROM payments WHERE partner_id=? AND (?='' OR status=?) AND date>=? AND date<=?",
    )
    .get(req.partnerId, st, st, from, to)).n;
  res.json({
    items: rows.map((x) => ({
      id: x.id,
      reference: x.reference,
      reservationId: x.reservation_id,
      guestName: x.guest_name,
      propertyName: x.property_name,
      date: x.date,
      amount: x.amount,
      currency: "AOA",
      method: x.method,
      status: x.status,
      isDemo: true,
    })),
    page,
    pageSize,
    total,
  });
});
}
