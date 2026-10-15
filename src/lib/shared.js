import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { db } from "./db.js";
export { db };
export const API = "/api/v1",
  now = () => new Date().toISOString(),
  uid = () => randomUUID(),
  hash = (s) => createHash("sha256").update(s).digest("hex");
export const fail = (res, status, code, message, details) =>
  res
    .status(status)
    .json({ error: { code, message, ...(details ? { details } : {}) } });
export const run = (res, schema, fn) => {
  const v = schema.safeParse(res.req.body);
  if (!v.success)
    return fail(
      res,
      400,
      "VALIDATION_ERROR",
      "Request validation failed",
      v.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    );
  return fn(v.data);
};
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v + "T00:00:00Z")), {
    message: "Expected YYYY-MM-DD date",
  });
export const enums = {
  propertyType: ["house", "apartment", "villa", "guesthouse", "other"],
  status: ["published", "draft"],
  reservation: ["pending", "confirmed", "checked_in", "completed", "cancelled"],
  payment: ["pending", "processing", "paid", "failed", "refunded"],
  methods: [
    "multicaixa_express",
    "multicaixa_reference",
    "cash",
    "bank_transfer",
  ],
  channels: ["in_person", "whatsapp", "phone", "website", "other"],
};
export const authenticate = async (req, res, next) => {
  const token = (req.headers.authorization || "").match(
    /^Bearer\s+(.+)$/i,
  )?.[1];
  if (!token) return fail(res, 401, "UNAUTHENTICATED", "Bearer token required");
  const s = await db
    .prepare("SELECT partner_id,expires_at FROM sessions WHERE token_hash=?")
    .get(hash(token));
  if (!s || new Date(s.expires_at).getTime() <= Date.now())
    return fail(res, 401, "UNAUTHENTICATED", "Session is invalid or expired");
  req.partnerId = s.partner_id;
  req.tokenHash = hash(token);
  next();
};
export const pget = async (id, partnerId) =>
  await db
    .prepare("SELECT * FROM properties WHERE id=? AND partner_id=?")
    .get(id, partnerId);
export const photoList = async (id) =>
  await db
    .prepare(
      "SELECT id,url,alt_text AS altText,sort_order AS sortOrder FROM property_photos WHERE property_id=? ORDER BY sort_order",
    )
    .all(id);
export const propOut = async (p) => ({
  ...p,
  id: p.id,
  name: p.name,
  type: p.type,
  province: p.province,
  city: p.city,
  neighborhood: p.neighborhood,
  address: p.address,
  bedrooms: p.bedrooms,
  bathrooms: p.bathrooms,
  guestCapacity: p.guest_capacity,
  areaSquareMeters: p.area_square_meters,
  floor: p.floor,
  amenities: typeof p.amenities === "string" ? JSON.parse(p.amenities) : p.amenities,
  description: p.description,
  nightlyRate: p.nightly_rate,
  currency: "AOA",
  status: p.status,
  photos: await photoList(p.id),
  rating: p.rating,
  reviewCount: p.review_count,
  occupancyRate: p.occupancy_rate,
  reservationCount: (await db
    .prepare(
      "SELECT count(*) n FROM reservations WHERE property_id=? AND status!='cancelled'",
    )
    .get(p.id)).n,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});
export const guestOut = async (g, all = false) => {
  const rs = await db
      .prepare(
        `SELECT r.*,p.name property_name FROM reservations r JOIN properties p ON p.id=r.property_id WHERE r.guest_id=? ORDER BY r.check_in DESC ${all ? "" : "LIMIT 5"}`,
      )
      .all(g.id),
    count = (await db
      .prepare("SELECT count(*) n FROM reservations WHERE guest_id=?")
      .get(g.id)).n;
  return {
    id: g.id,
    name: g.name,
    contact: g.contact,
    reservationCount: count,
    lastStayDate: rs[0]?.check_in || null,
    createdAt: g.created_at,
    recentReservations: rs.map((r) => ({
      id: r.id,
      propertyName: r.property_name,
      checkIn: r.check_in,
      checkOut: r.check_out,
      totalAmount: r.total_amount,
      currency: "AOA",
      status: r.status,
    })),
    ...(all ? { reservations: await Promise.all(rs.map(reservationOut)) } : {}),
  };
};
export async function reservationOut(r) {
  const row = r.guest_name
    ? r
    : await db
        .prepare(
          "SELECT r.*,p.name property_name,g.name guest_name,g.contact guest_contact FROM reservations r JOIN properties p ON p.id=r.property_id JOIN guests g ON g.id=r.guest_id WHERE r.id=?",
        )
        .get(r.id);
  return {
    id: row.id,
    reference: row.reference,
    propertyId: row.property_id,
    propertyName: row.property_name,
    guest: {
      id: row.guest_id,
      name: row.guest_name,
      contact: row.guest_contact,
    },
    checkIn: row.check_in,
    checkOut: row.check_out,
    guestCount: row.guest_count,
    nightCount: row.night_count,
    nightlyRate: row.nightly_rate,
    totalAmount: row.total_amount,
    currency: "AOA",
    paymentMethod: row.payment_method,
    invoiceRequested: !!row.invoice_requested,
    channel: row.channel,
    status: row.status,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paymentSummary:
      await db
        .prepare(
          'SELECT status,amount,method,is_demo AS "isDemo" FROM payments WHERE reservation_id=?',
        )
        .get(row.id) || null,
  };
}
export const reservationCreate = db.transaction(
  async ({
    partnerId,
    propertyId,
    guest,
    checkIn,
    checkOut,
    guestCount,
    paymentMethod,
    invoiceRequested = false,
    channel = "in_person",
    status = "confirmed",
  }) => {
    const prop = await pget(propertyId, partnerId);
    if (!prop)
      throw Object.assign(Error("Property not found"), { status: 404 });
    if (guestCount > prop.guest_capacity)
      throw Object.assign(Error("Guest count exceeds property capacity"), {
        status: 400,
        code: "CAPACITY_EXCEEDED",
      });
    const nights =
      (Date.parse(checkOut + "T00:00:00Z") -
        Date.parse(checkIn + "T00:00:00Z")) /
      86400000;
    if (nights < 1 || !Number.isInteger(nights))
      throw Object.assign(Error("Check-out must be after check-in"), {
        status: 400,
      });
    if (
      checkIn <
      new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Luanda" })
    )
      throw Object.assign(Error("Check-in cannot be in the past"), {
        status: 400,
      });
    if (
      await db
        .prepare(
          "SELECT 1 FROM reservations WHERE property_id=? AND status!='cancelled' AND check_in<? AND check_out>? LIMIT 1",
        )
        .get(propertyId, checkOut, checkIn)
    )
      throw Object.assign(Error("Property is unavailable for selected dates"), {
        status: 409,
        code: "DATES_UNAVAILABLE",
      });
    let g = await db
      .prepare("SELECT * FROM guests WHERE partner_id=? AND contact=?")
      .get(partnerId, guest.contact);
    if (g)
      await db.prepare("UPDATE guests SET name=? WHERE id=?").run(guest.name, g.id);
    else {
      const id = uid();
      await db.prepare(
        "INSERT INTO guests(id,partner_id,name,contact,created_at) VALUES(?,?,?,?,?)",
      ).run(id, partnerId, guest.name, guest.contact, now());
      g = { id, name: guest.name, contact: guest.contact, created_at: now() };
    }
    const id = uid(),
      created = now(),
      ref = "RSV-" + created.slice(0, 4) + "-" + String(Date.now()).slice(-6),
      amount = prop.nightly_rate * nights;
    await db.prepare(
      "INSERT INTO reservations(id,reference,partner_id,property_id,guest_id,check_in,check_out,guest_count,night_count,nightly_rate,total_amount,payment_method,invoice_requested,channel,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      ref,
      partnerId,
      propertyId,
      g.id,
      checkIn,
      checkOut,
      guestCount,
      nights,
      prop.nightly_rate,
      amount,
      paymentMethod,
      invoiceRequested,
      channel,
      status,
      created,
      created,
    );
    await db.prepare(
      "INSERT INTO payments(id,reference,reservation_id,partner_id,date,amount,method,status,is_demo) VALUES(?,?,?,?,?,?,?,?,1)",
    ).run(
      uid(),
      "PAY-" + created.slice(0, 4) + "-" + String(Date.now()).slice(-6),
      id,
      partnerId,
      created,
      amount,
      paymentMethod,
      "pending",
    );
    return id;
  },
);
