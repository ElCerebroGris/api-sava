import { db, API, now, uid, hash, fail, run, pageSchema, date, enums, authenticate, pget, photoList, propOut, guestOut, reservationOut, reservationCreate } from "../lib/shared.js";
import { z } from "zod";

export default function register(app) {
app.get(API + "/settings", authenticate, async (req, res) => {
  const p = await db
      .prepare("SELECT name,email,language FROM partners WHERE id=?")
      .get(req.partnerId),
    s = await db
      .prepare("SELECT * FROM settings WHERE partner_id=?")
      .get(req.partnerId);
  res.json({
    ...p,
    bookingNotifications: !!s?.booking_notifications,
    paymentNotifications: !!s?.payment_notifications,
  });
});
app.patch(API + "/settings", authenticate, async (req, res) =>
  run(
    res,
    z
      .object({
        name: z.string().min(2).optional(),
        email: z.string().email().optional(),
        language: z.string().min(2).optional(),
        bookingNotifications: z.boolean().optional(),
        paymentNotifications: z.boolean().optional(),
      })
      .refine((x) => Object.keys(x).length > 0),
    async (d) => {
      try {
        const p = await db
          .prepare("SELECT * FROM partners WHERE id=?")
          .get(req.partnerId);
        await db.prepare(
          "UPDATE partners SET name=?,email=?,language=? WHERE id=?",
        ).run(
          d.name ?? p.name,
          d.email ?? p.email,
          d.language ?? p.language,
          req.partnerId,
        );
        const s = await db
          .prepare("SELECT * FROM settings WHERE partner_id=?")
          .get(req.partnerId);
        await db.prepare(
          "INSERT INTO settings(partner_id,booking_notifications,payment_notifications) VALUES(?,?,?) ON CONFLICT(partner_id) DO UPDATE SET booking_notifications=EXCLUDED.booking_notifications,payment_notifications=EXCLUDED.payment_notifications",
        ).run(
          req.partnerId,
          d.bookingNotifications ?? !!s?.booking_notifications,
          d.paymentNotifications ?? !!s?.payment_notifications,
        );
        const up = await db
            .prepare("SELECT name,email,language FROM partners WHERE id=?")
            .get(req.partnerId),
          ns = await db
            .prepare("SELECT * FROM settings WHERE partner_id=?")
            .get(req.partnerId);
        res.json({
          ...up,
          bookingNotifications: !!ns.booking_notifications,
          paymentNotifications: !!ns.payment_notifications,
        });
      } catch {
        return fail(res, 409, "EMAIL_EXISTS", "Email is already used");
      }
    },
  ),
);
}
