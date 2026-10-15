import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { db, API, now, uid, hash, fail, run, pageSchema, date, enums, authenticate, pget, photoList, propOut, guestOut, reservationOut, reservationCreate } from "../lib/shared.js";

export default function register(app) {
app.get(API + "/properties", authenticate, async (req, res) => {
  const v = pageSchema.safeParse(req.query);
  if (!v.success)
    return fail(res, 400, "VALIDATION_ERROR", "Invalid pagination");
  const { page, pageSize } = v.data,
    q = (req.query.q || "").toLowerCase(),
    status = req.query.status;
  const rows = await db
      .prepare(
        `SELECT * FROM properties WHERE partner_id=? AND (?='' OR lower(name||' '||city||' '||neighborhood) LIKE ?) AND (?='' OR status=?) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(
        req.partnerId,
        q,
        "%" + q + "%",
        status || "",
        status || "",
        pageSize,
        (page - 1) * pageSize,
      ),
    total = (await db
      .prepare(
        `SELECT count(*) n FROM properties WHERE partner_id=? AND (?='' OR lower(name||' '||city||' '||neighborhood) LIKE ?) AND (?='' OR status=?)`,
      )
      .get(req.partnerId, q, "%" + q + "%", status || "", status || "")).n;
  res.json({ items: await Promise.all(rows.map(propOut)), page, pageSize, total });
});
const propBody = z.object({
  name: z.string().min(2).max(120),
  type: z.enum(enums.propertyType),
  province: z.string().min(2),
  city: z.string().min(2),
  neighborhood: z.string().min(2),
  address: z.string().default(""),
  bedrooms: z.number().int().min(0),
  bathrooms: z.number().min(0),
  guestCapacity: z.number().int().min(1),
  areaSquareMeters: z.number().int().positive(),
  floor: z.string().nullable().optional(),
  amenities: z.array(z.string()),
  description: z.string().min(1),
  nightlyRate: z.number().int().min(0),
  status: z.enum(enums.status).default("draft"),
});
const saveProperty = async (x, id, partnerId) => {
  const t = now();
  if (id)
    await db.prepare(
      "UPDATE properties SET name=?,type=?,province=?,city=?,neighborhood=?,address=?,bedrooms=?,bathrooms=?,guest_capacity=?,area_square_meters=?,floor=?,amenities=?,description=?,nightly_rate=?,status=?,updated_at=? WHERE id=? AND partner_id=?",
    ).run(
      x.name,
      x.type,
      x.province,
      x.city,
      x.neighborhood,
      x.address,
      x.bedrooms,
      x.bathrooms,
      x.guestCapacity,
      x.areaSquareMeters,
      x.floor || null,
      JSON.stringify(x.amenities),
      x.description,
      x.nightlyRate,
      x.status,
      t,
      id,
      partnerId,
    );
  else {
    id = uid();
    await db.prepare(
      "INSERT INTO properties(id,partner_id,name,type,province,city,neighborhood,address,bedrooms,bathrooms,guest_capacity,area_square_meters,floor,amenities,description,nightly_rate,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      partnerId,
      x.name,
      x.type,
      x.province,
      x.city,
      x.neighborhood,
      x.address,
      x.bedrooms,
      x.bathrooms,
      x.guestCapacity,
      x.areaSquareMeters,
      x.floor || null,
      JSON.stringify(x.amenities),
      x.description,
      x.nightlyRate,
      x.status,
      t,
      t,
    );
  }
  return id;
};
app.post(API + "/properties", authenticate, async (req, res) =>
  run(res, propBody, async (x) => {
    const id = await saveProperty(x, null, req.partnerId);
    res.status(201).json(await propOut(await pget(id, req.partnerId)));
  }),
);
app.get(API + "/properties/:id", authenticate, async (req, res) => {
  const p = await pget(req.params.id, req.partnerId);
  return p
    ? res.json(await propOut(p))
    : fail(res, 404, "NOT_FOUND", "Property not found");
});
app.patch(API + "/properties/:id", authenticate, async (req, res) => {
  const old = await pget(req.params.id, req.partnerId);
  if (!old) return fail(res, 404, "NOT_FOUND", "Property not found");
  const merged = {
    name: old.name,
    type: old.type,
    province: old.province,
    city: old.city,
    neighborhood: old.neighborhood,
    address: old.address,
    bedrooms: old.bedrooms,
    bathrooms: old.bathrooms,
    guestCapacity: old.guest_capacity,
    areaSquareMeters: old.area_square_meters,
    floor: old.floor,
    amenities: typeof old.amenities === "string" ? JSON.parse(old.amenities) : old.amenities,
    description: old.description,
    nightlyRate: old.nightly_rate,
    status: old.status,
    ...req.body,
  };
  return run(res, propBody, async () => {
    await saveProperty(merged, old.id, req.partnerId);
    res.json(await propOut(await pget(old.id, req.partnerId)));
  });
});
const upload = multer({
  storage: multer.diskStorage({
    destination: (r, f, cb) => {
      fs.mkdirSync("uploads", { recursive: true });
      cb(null, "uploads");
    },
    filename: (r, f, cb) =>
      cb(null, uid() + path.extname(f.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (r, f, cb) =>
    cb(
      null,
      ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
        f.mimetype,
      ),
    ),
});
app.post(
  API + "/properties/:id/photos",
  authenticate,
  upload.single("file"),
  async (req, res) => {
    if (!await pget(req.params.id, req.partnerId))
      return fail(res, 404, "NOT_FOUND", "Property not found");
    if (!req.file)
      return fail(res, 400, "INVALID_FILE", "An image file is required");
    const id = uid(),
      sort = Number(req.body.sortOrder || 0),
      alt = req.body.altText || null,
      url = "/uploads/" + req.file.filename;
    await db.prepare(
      "INSERT INTO property_photos(id,property_id,url,alt_text,sort_order,created_at) VALUES(?,?,?,?,?,?)",
    ).run(id, req.params.id, url, alt, sort, now());
    res.status(201).json({ id, url, altText: alt, sortOrder: sort });
  },
);
app.patch(API + "/properties/:id/photos/order", authenticate, async (req, res) => {
  if (!await pget(req.params.id, req.partnerId))
    return fail(res, 404, "NOT_FOUND", "Property not found");
  return run(res, z.object({ photoIds: z.array(z.string().uuid()) }), async (d) => {
    const photos = (await db
      .prepare("SELECT id FROM property_photos WHERE property_id=?")
      .all(req.params.id))
      .map((x) => x.id);
    if (
      photos.length !== d.photoIds.length ||
      d.photoIds.some((x) => !photos.includes(x))
    )
      return fail(
        res,
        400,
        "INVALID_PHOTOS",
        "photoIds must include each property photo exactly once",
      );
    const q = db.prepare(
      "UPDATE property_photos SET sort_order=? WHERE id=? AND property_id=?",
    );
    for (const [i, x] of d.photoIds.entries()) await q.run(i, x, req.params.id);
    res.json({ photos: await photoList(req.params.id) });
  });
});
app.delete(
  API + "/properties/:id/photos/:photoId",
  authenticate,
  async (req, res) => {
    if (!await pget(req.params.id, req.partnerId))
      return fail(res, 404, "NOT_FOUND", "Property not found");
    const r = await db
      .prepare("DELETE FROM property_photos WHERE id=? AND property_id=?")
      .run(req.params.photoId, req.params.id);
    r.changes
      ? res.json({ success: true })
      : fail(res, 404, "NOT_FOUND", "Photo not found");
  },
);
}
