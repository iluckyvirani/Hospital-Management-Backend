const PDFDocument = require("pdfkit");
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");

// ─── Get Billing Dashboard ─────────────────────────────────
const getBillingDashboard = asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    totalBills,
    pendingBills,
    todayCollection,
    monthCollection,
    recentBills,
    recentDeposits,
    pendingRefunds,
  ] = await Promise.all([
    prisma.finalBill.count(),
    prisma.finalBill.count({ where: { paymentStatus: "PENDING" } }),
    prisma.finalBill.aggregate({
      where: { generatedDate: { gte: today, lt: tomorrow }, paymentStatus: "PAID" },
      _sum: { grossTotal: true },
    }),
    prisma.finalBill.aggregate({
      where: { generatedDate: { gte: startOfMonth }, paymentStatus: "PAID" },
      _sum: { grossTotal: true },
    }),
    prisma.finalBill.findMany({
      take: 10,
      orderBy: { generatedDate: "desc" },
      include: {
        admission: {
          select: {
            admitId: true,
            patient: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    }),
    prisma.deposit.findMany({
      take: 10,
      orderBy: { paymentDate: "desc" },
      include: {
        admission: {
          select: {
            admitId: true,
            patient: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.finalBill.findMany({
      where: { refundAmount: { gt: 0 } },
      orderBy: { generatedDate: "desc" },
      include: {
        admission: {
          select: {
            admitId: true,
            patient: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      stats: {
        totalBills,
        pendingBills,
        todayCollection: todayCollection._sum.grossTotal || 0,
        monthCollection: monthCollection._sum.grossTotal || 0,
      },
      recentBills,
      recentDeposits,
      pendingRefunds,
    }, "Billing dashboard fetched successfully")
  );
});

// ─── Get All Bills ─────────────────────────────────────────
const getAllBills = asyncHandler(async (req, res) => {
  const { search, status, from, to, page = 1, limit = 20 } = req.query;

  const where = {};
  if (status) where.paymentStatus = status;

  if (from || to) {
    where.generatedDate = {};
    if (from) where.generatedDate.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.generatedDate.lte = toDate;
    }
  }

  if (search) {
    where.admission = {
      OR: [
        { patient: { name: { contains: search, mode: "insensitive" } } },
        { patient: { phone: { contains: search } } },
        { admitId: { contains: search, mode: "insensitive" } },
      ],
    };
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [bills, total] = await Promise.all([
    prisma.finalBill.findMany({
      where,
      include: {
        admission: {
          include: {
            patient: { select: { id: true, name: true, phone: true } },
            doctor: { select: { name: true } },
            room: { include: { roomType: true } },
            bed: true,
          },
        },
      },
      orderBy: { generatedDate: "desc" },
      skip,
      take: parseInt(limit),
    }),
    prisma.finalBill.count({ where }),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      bills,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }, "Bills fetched successfully")
  );
});

// ─── Generate Final Bill ───────────────────────────────────
const generateBill = asyncHandler(async (req, res) => {
  const {
    admissionId,
    otherCharges,
    discountAmount,
    paymentMode,
    notes,
  } = req.body;

  if (!admissionId) throw new ApiError(400, "admissionId is required");

  const admission = await prisma.admission.findUnique({
    where: { id: admissionId },
    include: {
      room: { include: { roomType: true } },
      deposits: true,
      patientServices: { include: { service: true } },
      finalBill: true,
    },
  });

  if (!admission) throw new ApiError(404, "Admission not found");
  if (admission.finalBill) throw new ApiError(400, "Final bill already generated for this admission");

  // Calculate room charges (both admission and discharge day count)
  const dischargeDate = admission.actualDischarge || new Date();
  const admitDate = new Date(admission.admissionDate);
  const days = Math.max(1, Math.ceil((dischargeDate - admitDate) / (1000 * 60 * 60 * 24)) + 1);
  const roomRate = parseFloat(admission.room.roomType.rentPerDay);
  const roomCharges = roomRate * days;

  // Calculate service charges
  const serviceCharges = admission.patientServices.reduce(
    (sum, ps) => sum + parseFloat(ps.totalFee), 0
  );

  // Other charges
  const otherChargesAmount = otherCharges ? parseFloat(otherCharges) : 0;
  const discountAmountValue = discountAmount ? parseFloat(discountAmount) : 0;

  // Gross total
  const grossTotal = roomCharges + serviceCharges + otherChargesAmount - discountAmountValue;


  // Total deposits
  const totalDeposits = admission.deposits.reduce(
    (sum, d) => sum + parseFloat(d.amount), 0
  );

  // Balance or refund
  const balanceDue = Math.max(0, grossTotal - totalDeposits);
  const refundAmount = Math.max(0, totalDeposits - grossTotal);

  // Generate bill number: BILL-001, BILL-002, ...
  const lastBill = await prisma.finalBill.findFirst({
    orderBy: { createdAt: "desc" },
    select: { billNumber: true },
  });
  let nextSeq = 1;
  if (lastBill?.billNumber) {
    const match = lastBill.billNumber.match(/(\d+)$/);
    if (match) nextSeq = parseInt(match[1], 10) + 1;
  }
  const billNumber = `BILL-${String(nextSeq).padStart(3, "0")}`;

  const bill = await prisma.finalBill.create({
    data: {
      billNumber,
      admissionId,
      roomCharges,
      serviceCharges,
      otherCharges: otherChargesAmount,
      discountAmount: discountAmountValue,
      grossTotal,
      totalDeposits,
      balanceDue,
      refundAmount,
      paymentStatus: balanceDue <= 0 ? "PAID" : "PENDING",
      paymentMode: paymentMode || null,
      notes,
    },
    include: {
      admission: {
        include: {
          patient: true,
          doctor: { select: { name: true, specialization: true } },
          room: { include: { roomType: true } },
          bed: true,
          deposits: true,
          patientServices: { include: { service: true } },
        },
      },
    },
  });

  return res.status(201).json(
    new ApiResponse(201, {
      ...bill,
      days,
      roomRate,
    }, "Final bill generated successfully")
  );
});

// ─── Update Bill Payment ───────────────────────────────────
// const updateBillPayment = asyncHandler(async (req, res) => {
//   const { id } = req.params;
//   const { paymentStatus, paymentMode } = req.body;

//   const bill = await prisma.finalBill.findUnique({ where: { id } });
//   if (!bill) throw new ApiError(404, "Bill not found");

//   const updated = await prisma.finalBill.update({
//     where: { id },
//     data: {
//       ...(paymentStatus && { paymentStatus }),
//       ...(paymentMode && { paymentMode }),
//       ...(paymentStatus === 'PAID' && { balanceDue: 0 }),
//     },
//   });

//   return res.status(200).json(
//     new ApiResponse(200, updated, "Bill payment updated successfully")
//   );
// });


const updateBillPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { paymentStatus, paymentMode, refundDate, refundMode } = req.body;

  const bill = await prisma.finalBill.findUnique({
    where: { id },
    include: { admission: { include: { deposits: true } } }
  });
  if (!bill) throw new ApiError(404, "Bill not found");

  // ── Process refund ──────────────────────────────────────
  if (refundDate && parseFloat(bill.refundAmount) > 0) {
    const updated = await prisma.finalBill.update({
      where: { id },
      data: {
        refundDate: new Date(refundDate),
        refundMode: refundMode || paymentMode || null,
      },
    });

    return res.status(200).json(
      new ApiResponse(200, updated, "Refund processed successfully")
    );
  }

  // When marking as PAID and there is a balance due, create auto-deposit
  if (paymentStatus === "PAID" && parseFloat(bill.balanceDue) > 0) {
    const resolvedPaymentMode = paymentMode || bill.paymentMode;
    if (!resolvedPaymentMode) {
      throw new ApiError(400, "Payment mode is required when collecting payment");
    }

    // Generate next receipt number
    const lastDep = await prisma.deposit.findFirst({ orderBy: { createdAt: "desc" } });
    let nextSeq = 1;
    if (lastDep && lastDep.receiptNumber) {
      const match = lastDep.receiptNumber.match(/(\d+)$/);
      if (match) nextSeq = parseInt(match[1], 10) + 1;
    }
    const receiptNumber = `DEP-${new Date().getFullYear()}-${String(nextSeq).padStart(4, "0")}`;

    const balanceAmount = parseFloat(bill.balanceDue);

    // Recalculate totalDeposits: existing deposits + new auto-deposit
    const existingDepositsTotal = bill.admission.deposits.reduce(
      (sum, d) => sum + parseFloat(d.amount), 0
    );
    const newTotalDeposits = existingDepositsTotal + balanceAmount;

    // Use a transaction to update bill + create deposit atomically
    const [updated, deposit] = await prisma.$transaction([
      prisma.finalBill.update({
        where: { id },
        data: {
          paymentStatus: "PAID",
          paymentMode: resolvedPaymentMode,
          balanceDue: 0,
          totalDeposits: newTotalDeposits,
        },
      }),
      prisma.deposit.create({
        data: {
          admissionId: bill.admissionId,
          amount: balanceAmount,
          paymentMode: resolvedPaymentMode,
          receiptNumber,
          notes: `Auto-deposit for final bill settlement (Bill #${bill.billNumber || bill.id.slice(-8)})`,
        },
      }),
    ]);

    return res.status(200).json(
      new ApiResponse(200, { bill: updated, autoDeposit: deposit }, "Bill marked as paid and deposit recorded")
    );
  }

  // Normal update (no auto deposit needed)
  const updated = await prisma.finalBill.update({
    where: { id },
    data: {
      ...(paymentStatus && { paymentStatus }),
      ...(paymentMode && { paymentMode }),
    },
  });

  return res.status(200).json(
    new ApiResponse(200, updated, "Bill payment updated successfully")
  );
});



// ─── Full Bill Update (SUPER_ADMIN) — recalculates totals ─
const updateBill = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { roomCharges, serviceCharges, otherCharges, discountAmount, paymentMode, paymentStatus, notes } = req.body;

  const bill = await prisma.finalBill.findUnique({
    where: { id },
    include: {
      admission: { include: { deposits: true } },
    },
  });
  if (!bill) throw new ApiError(404, "Bill not found");

  // Use new values if provided, otherwise keep existing
  const newRoomCharges = roomCharges !== undefined ? parseFloat(roomCharges) : parseFloat(bill.roomCharges);
  const newServiceCharges = serviceCharges !== undefined ? parseFloat(serviceCharges) : parseFloat(bill.serviceCharges);
  const newOtherCharges = otherCharges !== undefined ? parseFloat(otherCharges) : parseFloat(bill.otherCharges);
  const newDiscountAmount = discountAmount !== undefined ? parseFloat(discountAmount) : parseFloat(bill.discountAmount);

  // Recalculate derived totals
  const newGrossTotal = newRoomCharges + newServiceCharges + newOtherCharges - newDiscountAmount;

  // Get fresh deposit total
  const totalDeposits = bill.admission.deposits.reduce((sum, d) => sum + parseFloat(d.amount), 0);

  const newBalanceDue = Math.max(0, newGrossTotal - totalDeposits);
  const newRefundAmount = Math.max(0, totalDeposits - newGrossTotal);

  // Auto-resolve paymentStatus if not manually set
  const resolvedPaymentStatus = paymentStatus || (newBalanceDue <= 0 ? "PAID" : "PENDING");

  const updated = await prisma.finalBill.update({
    where: { id },
    data: {
      roomCharges: newRoomCharges,
      serviceCharges: newServiceCharges,
      otherCharges: newOtherCharges,
      discountAmount: newDiscountAmount,
      grossTotal: newGrossTotal,
      totalDeposits,
      balanceDue: newBalanceDue,
      refundAmount: newRefundAmount,
      paymentStatus: resolvedPaymentStatus,
      ...(paymentMode !== undefined && { paymentMode }),
      ...(notes !== undefined && { notes }),
    },
    include: {
      admission: {
        include: {
          patient: { select: { id: true, name: true, phone: true } },
          doctor: { select: { name: true } },
          deposits: true,
        },
      },
    },
  });

  return res.status(200).json(new ApiResponse(200, updated, "Bill updated and totals recalculated successfully"));
});

// ─── Delete Bill (SUPER_ADMIN only) ───────────────────────
const deleteBill = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const bill = await prisma.finalBill.findUnique({ where: { id } });
  if (!bill) throw new ApiError(404, "Bill not found");

  await prisma.finalBill.delete({ where: { id } });

  return res.status(200).json(new ApiResponse(200, {}, "Bill deleted successfully"));
});

// ─── Get All Deposits (paginated) ─────────────────────────
const getAllDeposits = asyncHandler(async (req, res) => {
  const { search, from, to, page = 1, limit = 10 } = req.query;

  const where = {};

  if (from || to) {
    where.paymentDate = {};
    if (from) {
      const fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);
      where.paymentDate.gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.paymentDate.lte = toDate;
    }
  }

  if (search) {
    where.OR = [
      { receiptNumber: { contains: search, mode: "insensitive" } },
      { admission: { admitId: { contains: search, mode: "insensitive" } } },
      { admission: { patient: { name: { contains: search, mode: "insensitive" } } } },
      { admission: { patient: { phone: { contains: search } } } },
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [deposits, total] = await Promise.all([
    prisma.deposit.findMany({
      where,
      include: {
        admission: {
          select: {
            admitId: true,
            patient: { select: { id: true, name: true, phone: true } },
          },
        },
      },
      orderBy: { paymentDate: "desc" },
      skip,
      take: parseInt(limit),
    }),
    prisma.deposit.count({ where }),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      deposits,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }, "Deposits fetched successfully")
  );
});

// ── PDF helpers (same as pdf.controller) ──────────────────
function _formatDate(date) {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function _drawTableHeader(doc, headers, colWidths, startX, y) {
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

function _drawTableRow(doc, cells, colWidths, startX, y, isAlt) {
  const rowHeight = 20;
  if (isAlt) {
    doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill("#f8fafc");
  }
  doc.fillColor("#1e293b").fontSize(7).font("Helvetica");
  let x = startX;
  cells.forEach((cell, i) => {
    doc.text(String(cell ?? ""), x + 4, y + 6, {
      width: colWidths[i] - 8, align: "left", lineBreak: false,
    });
    x += colWidths[i];
  });
  return y + rowHeight;
}

// ── Export Deposits as PDF ─────────────────────────────────
const exportDepositsPdf = asyncHandler(async (req, res) => {
  const { from, to, search } = req.query;

  const where = {};
  if (from || to) {
    where.paymentDate = {};
    if (from) {
      const fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);
      where.paymentDate.gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.paymentDate.lte = toDate;
    }
  }
  if (search) {
    where.OR = [
      { receiptNumber: { contains: search, mode: "insensitive" } },
      { admission: { admitId: { contains: search, mode: "insensitive" } } },
      { admission: { patient: { name: { contains: search, mode: "insensitive" } } } },
      { admission: { patient: { phone: { contains: search } } } },
    ];
  }

  const deposits = await prisma.deposit.findMany({
    where,
    include: {
      admission: {
        select: {
          admitId: true,
          patient: { select: { id: true, name: true, phone: true } },
        },
      },
    },
    orderBy: { paymentDate: "desc" },
  });

  if (deposits.length === 0) {
    throw new ApiError(404, "No deposit records found for the given filters");
  }

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=Deposits_Report_${from || "all"}_${to || "all"}.pdf`
  );
  doc.pipe(res);

  // Header
  doc.fontSize(16).font("Helvetica-Bold").fillColor("#1e293b");
  doc.text("Dimag Hospital", { align: "center" });
  doc.moveDown(0.2);
  doc.fontSize(9).font("Helvetica").fillColor("#475569");
  doc.text("42/4 B, Billochpura, Mathura Road, Agra-2", { align: "center" });
  doc.moveDown(0.1);
  doc.fontSize(8).fillColor("#64748b");
  doc.text("Ph: 74090 00917", { align: "center" });
  doc.moveDown(0.4);
  doc.fontSize(12).font("Helvetica-Bold").fillColor("#475569");
  doc.text("Deposit Records Report", { align: "center" });
  doc.moveDown(0.3);

  if (from || to) {
    doc.fontSize(9).fillColor("#64748b");
    const range = from && to
      ? `${_formatDate(from)} — ${_formatDate(to)}`
      : from ? `From: ${_formatDate(from)}` : `To: ${_formatDate(to)}`;
    doc.text(`Date Range: ${range}`, { align: "center" });
  } else {
    doc.fontSize(9).fillColor("#64748b");
    doc.text("All Records", { align: "center" });
  }

  doc.moveDown(0.3);
  doc.fontSize(8).fillColor("#94a3b8");
  doc.text(`Generated on: ${_formatDate(new Date())}`, { align: "center" });
  doc.moveDown(0.6);

  // Summary
  const totalAmount = deposits.reduce((sum, d) => sum + parseFloat(d.amount), 0);
  const onlineModes = ["CARD", "UPI", "CHEQUE", "ONLINE", "BANK_TRANSFER"];
  const totalCash = deposits
    .filter(d => d.paymentMode === "CASH")
    .reduce((sum, d) => sum + parseFloat(d.amount), 0);
  const totalOnline = deposits
    .filter(d => onlineModes.includes(d.paymentMode))
    .reduce((sum, d) => sum + parseFloat(d.amount), 0);

  doc.fontSize(9).font("Helvetica-Bold").fillColor("#334155");
  doc.text(
    `Total Deposits: ${deposits.length}  |  Total Amount: ₹${totalAmount.toLocaleString("en-IN")}  |  Cash: ₹${totalCash.toLocaleString("en-IN")}  |  Online: ₹${totalOnline.toLocaleString("en-IN")}`,
    { align: "center" }
  );
  doc.moveDown(0.8);

  // Table
  const headers = ["#", "Receipt No", "Admit ID", "Patient Name", "Phone", "Date", "Amount (₹)", "Mode", "Notes"];
  const colWidths = [25, 85, 70, 100, 80, 70, 70, 70, 160];
  const startX = 30;
  let y = doc.y;

  y = _drawTableHeader(doc, headers, colWidths, startX, y);

  deposits.forEach((d, idx) => {
    if (y > 520) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 30 });
      y = 30;
      y = _drawTableHeader(doc, headers, colWidths, startX, y);
    }

    const modeLabel = { CASH: "Cash", CARD: "Card", UPI: "UPI", BANK_TRANSFER: "Bank Transfer", CHEQUE: "Cheque", ONLINE: "Online" }[d.paymentMode] || d.paymentMode;

    const cells = [
      idx + 1,
      d.receiptNumber || "-",
      d.admission?.admitId || "-",
      d.admission?.patient?.name || "-",
      d.admission?.patient?.phone || "-",
      _formatDate(d.paymentDate),
      `₹${parseFloat(d.amount).toLocaleString("en-IN")}`,
      modeLabel,
      d.notes || "",
    ];

    y = _drawTableRow(doc, cells, colWidths, startX, y, idx % 2 === 1);
  });

  // Total row
  y += 4;
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#1e293b");
  doc.text(`Grand Total: ₹${totalAmount.toLocaleString("en-IN")}`, startX, y, { align: "right", width: colWidths.reduce((a, b) => a + b, 0) });

  doc.end();
});

// ── Export Refunds as PDF ──────────────────────────────────
const exportRefundsPdf = asyncHandler(async (req, res) => {
  const { from, to } = req.query;

  const where = { refundAmount: { gt: 0 } };
  if (from || to) {
    where.generatedDate = {};
    if (from) {
      const fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);
      where.generatedDate.gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.generatedDate.lte = toDate;
    }
  }

  const refunds = await prisma.finalBill.findMany({
    where,
    include: {
      admission: {
        select: {
          admitId: true,
          patient: { select: { id: true, name: true, phone: true } },
        },
      },
    },
    orderBy: { generatedDate: "desc" },
  });

  if (refunds.length === 0) {
    throw new ApiError(404, "No refund records found for the given filters");
  }

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=Refunds_Report_${from || "all"}_${to || "all"}.pdf`
  );
  doc.pipe(res);

  // Header
  doc.fontSize(16).font("Helvetica-Bold").fillColor("#1e293b");
  doc.text("Dimag Hospital", { align: "center" });
  doc.moveDown(0.2);
  doc.fontSize(9).font("Helvetica").fillColor("#475569");
  doc.text("42/4 B, Billochpura, Mathura Road, Agra-2", { align: "center" });
  doc.moveDown(0.1);
  doc.fontSize(8).fillColor("#64748b");
  doc.text("Ph: 74090 00917", { align: "center" });
  doc.moveDown(0.4);
  doc.fontSize(12).font("Helvetica-Bold").fillColor("#475569");
  doc.text("Refund Records Report", { align: "center" });
  doc.moveDown(0.3);

  if (from || to) {
    doc.fontSize(9).fillColor("#64748b");
    const range = from && to
      ? `${_formatDate(from)} — ${_formatDate(to)}`
      : from ? `From: ${_formatDate(from)}` : `To: ${_formatDate(to)}`;
    doc.text(`Date Range: ${range}`, { align: "center" });
  } else {
    doc.fontSize(9).fillColor("#64748b");
    doc.text("All Records", { align: "center" });
  }

  doc.moveDown(0.3);
  doc.fontSize(8).fillColor("#94a3b8");
  doc.text(`Generated on: ${_formatDate(new Date())}`, { align: "center" });
  doc.moveDown(0.6);

  // Summary
  const totalRefundAmount = refunds.reduce((sum, r) => sum + parseFloat(r.refundAmount), 0);
  const refunded = refunds.filter(r => r.refundDate);
  const pending = refunds.filter(r => !r.refundDate);
  const totalRefunded = refunded.reduce((sum, r) => sum + parseFloat(r.refundAmount), 0);
  const totalPending = pending.reduce((sum, r) => sum + parseFloat(r.refundAmount), 0);

  doc.fontSize(9).font("Helvetica-Bold").fillColor("#334155");
  doc.text(
    `Total: ${refunds.length}  |  Total Refund: ₹${totalRefundAmount.toLocaleString("en-IN")}  |  Refunded: ₹${totalRefunded.toLocaleString("en-IN")} (${refunded.length})  |  Pending: ₹${totalPending.toLocaleString("en-IN")} (${pending.length})`,
    { align: "center" }
  );
  doc.moveDown(0.8);

  // Table
  const headers = ["#", "Bill No", "Admit ID", "Patient Name", "Phone", "Bill Date", "Refund (₹)", "Status", "Refund Date", "Mode"];
  const colWidths = [25, 65, 80, 110, 80, 70, 70, 60, 80, 90];
  const startX = 30;
  let y = doc.y;

  y = _drawTableHeader(doc, headers, colWidths, startX, y);

  refunds.forEach((r, idx) => {
    if (y > 520) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 30 });
      y = 30;
      y = _drawTableHeader(doc, headers, colWidths, startX, y);
    }

    const modeLabel = r.refundMode
      ? ({ CASH: "Cash", CARD: "Card", UPI: "UPI", BANK_TRANSFER: "Bank Transfer", CHEQUE: "Cheque", ONLINE: "Online" }[r.refundMode] || r.refundMode)
      : "-";

    const cells = [
      idx + 1,
      r.billNumber || r.id.slice(-8),
      r.admission?.admitId || "-",
      r.admission?.patient?.name || "-",
      r.admission?.patient?.phone || "-",
      _formatDate(r.generatedDate),
      `₹${parseFloat(r.refundAmount).toLocaleString("en-IN")}`,
      r.refundDate ? "Refunded" : "Pending",
      r.refundDate ? _formatDate(r.refundDate) : "-",
      modeLabel,
    ];

    y = _drawTableRow(doc, cells, colWidths, startX, y, idx % 2 === 1);
  });

  // Total row
  y += 4;
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#1e293b");
  doc.text(`Grand Total: ₹${totalRefundAmount.toLocaleString("en-IN")}`, startX, y, { align: "right", width: colWidths.reduce((a, b) => a + b, 0) });

  doc.end();
});

module.exports = {
  getBillingDashboard,
  getAllBills,
  getAllDeposits,
  generateBill,
  updateBillPayment,
  updateBill,
  deleteBill,
  exportDepositsPdf,
  exportRefundsPdf,
};
