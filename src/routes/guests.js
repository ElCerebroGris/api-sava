import { db, API, now, uid, hash, fail, run, pageSchema, date, enums, authenticate, pget, photoList, propOut, guestOut, reservationOut, reservationCreate } from "../lib/shared.js";

export default function register(app) {
app.get(API + "/guests", authenticate, async (req, res) => {
  const pg = pageSchema.safeParse(req.query);
  if (!pg.success)
    return fail(res, 400, "VALIDATION_ERROR", "Invalid pagination");
  const { page, pageSize } = pg.data,
    q = (req.query.q || "").toLowerCase();
  const rows = await db
      .prepare(
        "SELECT * FROM guests WHERE partner_id=? AND (?='' OR lower(name||' '||contact) LIKE ?) ORDER BY name LIMIT ? OFFSET ?",
      )
      .all(req.partnerId, q, "%" + q + "%", pageSize, (page - 1) * pageSize),
    total = (await db
      .prepare(
        "SELECT count(*) n FROM guests WHERE partner_id=? AND (?='' OR lower(name||' '||contact) LIKE ?)",
      )
      .get(req.partnerId, q, "%" + q + "%")).n;
  res.json({ items: await Promise.all(rows.map((g) => guestOut(g))), page, pageSize, total });
});
app.get(API + "/guests/:id", authenticate, async (req, res) => {
  const g = await db
    .prepare("SELECT * FROM guests WHERE id=? AND partner_id=?")
    .get(req.params.id, req.partnerId);
  return g
    ? res.json(await guestOut(g, true))
    : fail(res, 404, "NOT_FOUND", "Guest not found");
});
}
