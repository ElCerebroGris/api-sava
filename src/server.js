import "dotenv/config";
import "express-async-errors";
import express from "express";
import swaggerUi from "swagger-ui-express";
import multer from "multer";
import { API, enums, fail } from "./lib/shared.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static("uploads"));

import registerAuth from "./routes/auth.js";
import registerProperties from "./routes/properties.js";
import registerReservations from "./routes/reservations.js";
import registerBookingLinks from "./routes/booking-links.js";
import registerGuests from "./routes/guests.js";
import registerPayments from "./routes/payments.js";
import registerAnalytics from "./routes/analytics.js";
import registerSettings from "./routes/settings.js";

registerAuth(app);
registerProperties(app);
registerReservations(app);
registerBookingLinks(app);
registerGuests(app);
registerPayments(app);
registerAnalytics(app);
registerSettings(app);

const docs = {
  openapi: "3.0.3",
  info: {
    title: "Sava Partner API",
    version: "1.0.0",
    description:
      "Partner portal API. Money values are integer AOA. Payment records are demo records; no provider is connected.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
      ReservationStatus: { type: "string", enum: enums.reservation },
      ListingStatus: { type: "string", enum: enums.status },
      PaymentStatus: { type: "string", enum: enums.payment },
      Currency: { type: "string", enum: ["AOA"] },
    },
  },
  paths: {},
};
const paths = [
  "auth/login",
  "auth/logout",
  "auth/me",
  "dashboard/summary",
  "properties",
  "properties/{id}",
  "properties/{id}/photos",
  "properties/{id}/photos/order",
  "properties/{id}/photos/{photoId}",
  "reservations",
  "reservations/{id}",
  "reservations/{id}/status",
  "booking-links",
  "public/booking-requests/{token}",
  "public/booking-requests/{token}/submit",
  "guests",
  "guests/{id}",
  "payments",
  "analytics/summary",
  "settings",
];
for (const p of paths) {
  docs.paths["/" + p] = {};
  const methods =
    p === "auth/login" ||
    p === "properties" ||
    p === "reservations" ||
    p === "booking-links" ||
    p.endsWith("/submit") ||
    p.endsWith("/photos")
      ? ["post"]
      : p.includes("/photos/order") || p.endsWith("/status") || p === "settings"
        ? ["get", "patch"]
        : p.endsWith("/photos/{photoId}")
          ? ["delete"]
          : p.includes("{id}") || p.includes("{token}")
            ? ["get", "patch"]
            : ["get"];
  for (const method of methods)
    docs.paths["/" + p][method] = {
      summary: `${method.toUpperCase()} ${p}`,
      security:
        p.startsWith("public/") || p === "auth/login"
          ? []
          : [{ bearerAuth: [] }],
      responses: {
        200: { description: "Success" },
        400: { description: "Validation error" },
        401: { description: "Authentication required" },
        404: { description: "Not found" },
      },
    };
}
app.get(API + "/openapi.json", (req, res) => res.json(docs));
app.use(API + "/docs", swaggerUi.serve, swaggerUi.setup(docs));
app.use((e, req, res, next) => {
  if (e instanceof multer.MulterError)
    return fail(res, 400, "UPLOAD_ERROR", e.message);
  console.error(e);
  return fail(res, 500, "INTERNAL_ERROR", "An unexpected error occurred");
});
const port = Number(process.env.PORT || 3000);
app.listen(port, () =>
  console.log(`Sava API listening at http://localhost:${port}${API}`),
);
