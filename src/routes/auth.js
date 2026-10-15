import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db, API, now, uid, hash, fail, run, pageSchema, date, enums, authenticate, pget, photoList, propOut, guestOut, reservationOut, reservationCreate } from "../lib/shared.js";

export default function register(app) {
app.post(API + "/auth/login", async (req, res) =>
  run(
    res,
    z.object({ email: z.string().email(), password: z.string().min(1) }),
    async (d) => {
      const p = await db
        .prepare("SELECT * FROM partners WHERE lower(email)=lower(?)")
        .get(d.email);
      if (!p || !bcrypt.compareSync(d.password, p.password_hash))
        return fail(
          res,
          401,
          "INVALID_CREDENTIALS",
          "Email or password is incorrect",
        );
      const token = randomBytes(32).toString("base64url"),
        exp = new Date(Date.now() + 3600000).toISOString();
      await db.prepare(
        "INSERT INTO sessions(token_hash,partner_id,expires_at,created_at) VALUES(?,?,?,?)",
      ).run(hash(token), p.id, exp, now());
      res.json({
        accessToken: token,
        tokenType: "Bearer",
        expiresIn: 3600,
        partner: { id: p.id, name: p.name, email: p.email },
      });
    },
  ),
);
app.post(API + "/auth/logout", authenticate, async (req, res) => {
  await db.prepare("DELETE FROM sessions WHERE token_hash=?").run(req.tokenHash);
  res.json({ success: true });
});
app.get(API + "/auth/me", authenticate, async (req, res) => {
  const p = await db
    .prepare("SELECT id,name,email,language FROM partners WHERE id=?")
    .get(req.partnerId);
  res.json(p);
});
}
