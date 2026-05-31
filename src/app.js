const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const errorMiddleware = require("./middleware/error.middleware.js");

const app = express();

app.use(cors({
  origin: ["https://dimarg-hospital.vercel.app", process.env.CLIENT_URL].filter(Boolean),
  credentials: true,
}));
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// ─── Routes ───────────────────────────────────────────────
app.use("/api/auth",       require("./routes/auth.routes"));
app.use("/api/doctors",    require("./routes/doctor.routes"));
app.use("/api/rooms",      require("./routes/room.routes"));
app.use("/api/patients",   require("./routes/patient.routes"));
app.use("/api/opd",        require("./routes/opd.routes"));
app.use("/api/ipd",        require("./routes/admission.routes"));
app.use("/api/services",   require("./routes/service.routes"));
app.use("/api/billing",    require("./routes/billing.routes"));
app.use("/api/expenses",   require("./routes/expense.routes"));
app.use("/api/reports",    require("./routes/report.routes"));
app.use("/api/settings",   require("./routes/settings.routes"));
app.use("/api/dashboard",  require("./routes/dashboard.routes"));
app.use("/api/prescriptions", require("./routes/prescription.routes"));

// Global error handler — always last
app.use(errorMiddleware);

module.exports = app;