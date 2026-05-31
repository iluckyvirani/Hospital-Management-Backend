const PDFDocument = require("pdfkit");
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

// ── Helpers ────────────────────────────────────────────────
function formatDate(date) {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function parseDateRange(from, to) {
  const filter = {};
  if (from) {
    const fromDate = new Date(from);
    fromDate.setHours(0, 0, 0, 0);
    filter.gte = fromDate;
  }
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    filter.lte = toDate;
  }
  return filter;
}

function drawTableHeader(doc, headers, colWidths, startX, y) {
  doc.fontSize(8).font("Helvetica-Bold");
  doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), 18).fill("#f1f5f9");
  doc.fillColor("#334155");
  let x = startX;
  headers.forEach((h, i) => {
    doc.text(h, x + 4, y + 5, { width: colWidths[i] - 8, align: "left" });
    x += colWidths[i];
  });
  return y + 18;
}

function drawTableRow(doc, cells, colWidths, startX, y, isAlt) {
  const rowHeight = 20;
  if (isAlt) {
    doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill("#f8fafc");
  }
  doc.fillColor("#1e293b").fontSize(7).font("Helvetica");
  let x = startX;
  cells.forEach((cell, i) => {
    doc.text(String(cell ?? ""), x + 4, y + 6, {
      width: colWidths[i] - 8,
      align: "left",
      lineBreak: false,
    });
    x += colWidths[i];
  });
  return y + rowHeight;
}

function addPageHeader(doc, title, from, to) {
  doc.fontSize(16).font("Helvetica-Bold").fillColor("#1e293b");
  doc.text("Dimag Hospital", { align: "center" });

  // Address line (static Hinglish)
  doc.moveDown(0.2);
  doc.fontSize(9).font("Helvetica").fillColor("#475569");
  doc.text("42/4 B, Billochpura, Mathura Road, Agra-2", { align: "center" });

  // Phone line
  doc.moveDown(0.1);
  doc.fontSize(8).font("Helvetica").fillColor("#64748b");
  doc.text("Ph: 74090 00917", { align: "center" });

  doc.moveDown(0.4);
  doc.fontSize(12).font("Helvetica-Bold").fillColor("#475569");
  doc.text(title, { align: "center" });
  doc.moveDown(0.3);

  if (from || to) {
    doc.fontSize(9).fillColor("#64748b");
    const range = from && to
      ? `${formatDate(from)} — ${formatDate(to)}`
      : from
        ? `From: ${formatDate(from)}`
        : `To: ${formatDate(to)}`;
    doc.text(`Date Range: ${range}`, { align: "center" });
  } else {
    doc.fontSize(9).fillColor("#64748b");
    doc.text("All Records", { align: "center" });
  }

  doc.moveDown(0.3);
  doc.fontSize(8).fillColor("#94a3b8");
  doc.text(`Generated on: ${formatDate(new Date())}`, { align: "center" });
  doc.moveDown(1);
}

// ── Export IPD as PDF ──────────────────────────────────────
const exportIpdPdf = asyncHandler(async (req, res) => {
  const { from, to, status, search } = req.query;

  const where = {};
  if (status) where.status = status;
  if (from || to) {
    where.admissionDate = parseDateRange(from, to);
  }
  if (search) {
    where.OR = [
      { patient: { name: { contains: search, mode: "insensitive" } } },
      { patient: { phone: { contains: search } } },
      { admitId: { contains: search, mode: "insensitive" } },
    ];
  }

  const admissions = await prisma.admission.findMany({
    where,
    include: {
      patient: { select: { id: true, name: true, phone: true, age: true, gender: true } },
      doctor: { select: { id: true, name: true, specialization: true } },
      room: { include: { roomType: true } },
      bed: true,
      deposits: true,
      finalBill: true,
      patientServices: true,
    },
    orderBy: { admissionDate: "desc" },
  });

  if (admissions.length === 0) {
    throw new ApiError(404, "No IPD records found for the given filters");
  }

  // Create PDF
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=IPD_Report_${from || "all"}_${to || "all"}.pdf`
  );
  doc.pipe(res);

  addPageHeader(doc, "IPD Patient Report", from, to);

  // Summary
  const totalAdmitted = admissions.filter((a) => a.status !== "DISCHARGED").length;
  const totalDischarged = admissions.filter((a) => a.status === "DISCHARGED").length;
  const totalCritical = admissions.filter((a) => a.status === "CRITICAL").length;
  const totalDeposits = admissions.reduce(
    (sum, a) => sum + a.deposits.reduce((s, d) => s + parseFloat(d.amount), 0),
    0
  );
  const totalServices = admissions.reduce(
    (sum, a) => sum + a.patientServices.reduce((s, ps) => s + parseFloat(ps.totalFee), 0),
    0
  );
  const totalGross = admissions.reduce(
    (sum, a) => sum + (a.finalBill ? parseFloat(a.finalBill.grossTotal) : 0),
    0
  );

  doc.fontSize(9).font("Helvetica-Bold").fillColor("#334155");
  doc.text(
    `Total: ${admissions.length}  |  Admitted: ${totalAdmitted}  |  Discharged: ${totalDischarged}  |  Critical: ${totalCritical}  |  Deposits: ₹${totalDeposits.toLocaleString("en-IN")}  |  Services: ₹${totalServices.toLocaleString("en-IN")}  |  Billed Gross: ₹${totalGross.toLocaleString("en-IN")}`,
    { align: "center" }
  );
  doc.moveDown(0.8);

  // Table
  const headers = ["#", "Admit ID", "Patient Name", "Age/Gender", "Phone", "Doctor", "Room/Bed", "Admit Date", "Status", "Deposits", "Services", "Gross Total"];
  const colWidths = [22, 70, 80, 45, 70, 75, 60, 65, 60, 60, 60, 65];
  const startX = 30;
  let y = doc.y;

  y = drawTableHeader(doc, headers, colWidths, startX, y);

  admissions.forEach((a, idx) => {
    // Check if we need a new page
    if (y > 520) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 30 });
      y = 30;
      y = drawTableHeader(doc, headers, colWidths, startX, y);
    }

    const totalDep = a.deposits.reduce((s, d) => s + parseFloat(d.amount), 0);
    const totalSvc = a.patientServices.reduce((s, ps) => s + parseFloat(ps.totalFee), 0);
    const grossTotal = a.finalBill ? parseFloat(a.finalBill.grossTotal) : null;

    const cells = [
      idx + 1,
      a.admitId,
      a.patient?.name || "",
      `${a.patient?.age || ""}/${(a.patient?.gender || "")[0] || ""}`,
      a.patient?.phone || "",
      a.doctor?.name || "",
      `R${a.room?.roomNumber || ""}/B${a.bed?.bedNumber || ""}`,
      formatDate(a.admissionDate),
      a.status,
      `₹${totalDep.toLocaleString("en-IN")}`,
      `₹${totalSvc.toLocaleString("en-IN")}`,
      grossTotal !== null ? `₹${grossTotal.toLocaleString("en-IN")}` : "—",
    ];

    y = drawTableRow(doc, cells, colWidths, startX, y, idx % 2 === 1);
  });

  doc.end();
});

// ── Export OPD as PDF ──────────────────────────────────────
const exportOpdPdf = asyncHandler(async (req, res) => {
  const { from, to, paymentStatus, search } = req.query;

  const where = {};
  if (paymentStatus) where.paymentStatus = paymentStatus;
  if (from || to) {
    where.visitDate = parseDateRange(from, to);
  }
  if (search) {
    where.patient = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ],
    };
  }

  const visits = await prisma.opdVisit.findMany({
    where,
    include: {
      patient: { select: { id: true, name: true, phone: true, age: true, gender: true ,address: true} },
      doctor: { select: { id: true, name: true, specialization: true } },
    },
    orderBy: [{ visitDate: "desc" }, { invoiceSeq: "desc" }],
  });

  if (visits.length === 0) {
    throw new ApiError(404, "No OPD records found for the given filters");
  }

  // Create PDF
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=OPD_Report_${from || "all"}_${to || "all"}.pdf`
  );
  doc.pipe(res);

  addPageHeader(doc, "OPD Consultation Receipt / Report", from, to);

  // Summary
  const totalFee = visits.reduce((sum, v) => sum + parseFloat(v.fee || 0), 0);
  const paidCount = visits.filter((v) => v.paymentStatus === "PAID").length;
  const pendingCount = visits.filter((v) => v.paymentStatus === "PENDING").length;

  const onlineModes = ["CARD", "UPI", "CHEQUE", "ONLINE", "BANK_TRANSFER"];
  const totalCash = visits
    .filter((v) => v.paymentMode === "CASH")
    .reduce((sum, v) => sum + parseFloat(v.fee || 0), 0);
  const totalOnline = visits
    .filter((v) => onlineModes.includes(v.paymentMode))
    .reduce((sum, v) => sum + parseFloat(v.fee || 0), 0);

  doc.fontSize(9).font("Helvetica-Bold").fillColor("#334155");
  doc.text(
    `Total Consultation: ${visits.length}  |  Paid: ${paidCount}  |  Pending: ${pendingCount}  |  Total Fee: ₹${totalFee.toLocaleString("en-IN")}  |  Cash: ₹${totalCash.toLocaleString("en-IN")}  |  Online: ₹${totalOnline.toLocaleString("en-IN")}`,
    { align: "center" }
  );
  doc.moveDown(0.8);

  // Table
  const headers = ["#", "Invoice No.", "Patient Name", "Age/Gender", "Phone", "Doctor", "OPD Date", "Address", "Consult. Fee", "Payment", "Mode"];
  const colWidths = [25, 60, 85, 80, 70, 80, 65, 90, 70, 55, 60];
  const startX = 30;
  let y = doc.y;

  y = drawTableHeader(doc, headers, colWidths, startX, y);

  visits.forEach((v, idx) => {
    if (y > 520) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 30 });
      y = 30;
      y = drawTableHeader(doc, headers, colWidths, startX, y);
    }

    const cells = [
      idx + 1,
      v.invoiceNumber,
      v.patient?.name || "",
      `${v.patient?.age || ""}/${(v.patient?.gender || "")[0] || ""}`,
      v.patient?.phone || "",
      v.doctor?.name || "",
      formatDate(v.visitDate),
      v.patient?.address || "",
      `₹${parseFloat(v.fee || 0).toLocaleString("en-IN")}`,
      v.paymentStatus,
      v.paymentMode,
    ];

    y = drawTableRow(doc, cells, colWidths, startX, y, idx % 2 === 1);
  });

  doc.end();
});

module.exports = { exportIpdPdf, exportOpdPdf };
