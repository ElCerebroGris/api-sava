import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db, API, now, uid, hash, fail, run, pageSchema, date, enums, authenticate, pget, photoList, propOut, guestOut, reservationOut, reservationCreate } from "../lib/shared.js";

export default function register(app) {
app.post(API + "/booking-links", authenticate, async (req, res) =>
  run(
    res,
    z.object({
      propertyId: z.string().uuid(),
      checkIn: date,
      checkOut: date,
      guestCount: z.number().int().positive(),
      channel: z.enum(["whatsapp", "in_person", "phone", "other"]),
      guestContact: z.string().optional(),
    }),
    async (d) => {
      const p = await pget(d.propertyId, req.partnerId);
      if (!p) return fail(res, 404, "NOT_FOUND", "Property not found");
      if (d.guestCount > p.guest_capacity)
        return fail(
          res,
          400,
          "CAPACITY_EXCEEDED",
          "Guest count exceeds property capacity",
        );
      const nights =
        (Date.parse(d.checkOut) - Date.parse(d.checkIn)) / 86400000;
      if (!Number.isInteger(nights) || nights < 1)
        return fail(
          res,
          400,
          "INVALID_DATES",
          "Check-out must follow check-in",
        );
      if (
        await db
          .prepare(
            "SELECT 1 FROM reservations WHERE property_id=? AND status!='cancelled' AND check_in<? AND check_out>? LIMIT 1",
          )
          .get(p.id, d.checkOut, d.checkIn)
      )
        return fail(res, 409, "DATES_UNAVAILABLE", "Property is unavailable");
      const id = uid(),
        token = randomBytes(24).toString("base64url"),
        created = now(),
        expires = new Date(Date.now() + 7 * 86400000).toISOString(),
        total = nights * p.nightly_rate;
      await db.prepare(
        "INSERT INTO booking_links(id,token,partner_id,property_id,check_in,check_out,guest_count,channel,guest_contact,nightly_rate,estimated_total,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        token,
        req.partnerId,
        p.id,
        d.checkIn,
        d.checkOut,
        d.guestCount,
        d.channel,
        d.guestContact || null,
        p.nightly_rate,
        total,
        "active",
        expires,
        created,
      );
      res
        .status(201)
        .json({
          id,
          token,
          url: `${process.env.PUBLIC_BASE_URL || "http://localhost:3000"}/booking/request/${token}`,
          propertyId: p.id,
          propertyName: p.name,
          checkIn: d.checkIn,
          checkOut: d.checkOut,
          guestCount: d.guestCount,
          nightlyRate: p.nightly_rate,
          estimatedTotal: total,
          currency: "AOA",
          paymentOptions: ["multicaixa_express", "multicaixa_reference"],
          status: "active",
          expiresAt: expires,
        });
    },
  ),
);
async function publicLink(token) {
  const l = await db
    .prepare(
      "SELECT l.*,p.name,p.type,p.city,p.province,p.neighborhood,p.guest_capacity,p.description FROM booking_links l JOIN properties p ON p.id=l.property_id WHERE token=?",
    )
    .get(token);
  if (l && l.status === "active" && new Date(l.expires_at).getTime() <= Date.now()) {
    await db.prepare("UPDATE booking_links SET status='expired' WHERE id=?").run(
      l.id,
    );
    l.status = "expired";
  }
  return l;
}
app.get(API + "/public/booking-requests/:token", async (req, res) => {
  const l = await publicLink(req.params.token);
  if (!l) return fail(res, 404, "NOT_FOUND", "Booking link not found");
  if (l.status !== "active")
    return fail(res, 410, "LINK_INACTIVE", "Booking link is no longer active");
  res.json({
    property: {
      name: l.name,
      type: l.type,
      city: l.city,
      province: l.province,
      neighborhood: l.neighborhood,
      guestCapacity: l.guest_capacity,
      description: l.description,
    },
    checkIn: l.check_in,
    checkOut: l.check_out,
    guestCount: l.guest_count,
    nightlyRate: l.nightly_rate,
    estimatedTotal: l.estimated_total,
    currency: "AOA",
    paymentOptions: ["multicaixa_express", "multicaixa_reference"],
    expiresAt: l.expires_at,
  });
});
app.post(API + "/public/booking-requests/:token/submit", async (req, res) => {
  const l = await publicLink(req.params.token);
  if (!l) return fail(res, 404, "NOT_FOUND", "Booking link not found");
  if (l.status !== "active")
    return fail(res, 410, "LINK_INACTIVE", "Booking link is no longer active");
  const s = z.object({
    guest: z.object({ name: z.string().min(2), contact: z.string().min(5) }),
    paymentMethod: z.enum(["multicaixa_express", "multicaixa_reference"]),
    invoiceRequested: z.boolean().default(false),
  });
  return run(res, s, async (d) => {
    try {
      const id = await reservationCreate({
        partnerId: l.partner_id,
        propertyId: l.property_id,
        guest: d.guest,
        checkIn: l.check_in,
        checkOut: l.check_out,
        guestCount: l.guest_count,
        paymentMethod: d.paymentMethod,
        invoiceRequested: d.invoiceRequested,
        channel: l.channel,
        status: "pending",
      });
      await db.prepare("UPDATE booking_links SET status='submitted' WHERE id=?").run(
        l.id,
      );
      res
        .status(201)
        .json({
          reservation: await reservationOut({ id }),
          message: "Pedido de reserva enviado.",
        });
    } catch (e) {
      fail(res, e.status || 400, e.code || "RESERVATION_ERROR", e.message);
    }
  });
});
}
