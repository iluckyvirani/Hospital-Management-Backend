const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");

// Helper: get local date as "YYYY-MM-DD" → new Date(str) gives UTC midnight,
// matching how visitDate is stored from frontend date-only strings.
function localDayBounds(date = new Date()) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const start = new Date(Date.UTC(y, m, d));
  const end = new Date(Date.UTC(y, m, d + 1));
  return { start, end };
}

// ─── Get Next Token Number ─────────────────────────────────
const getNextToken = asyncHandler(async (req, res) => {
  const { start: today, end: tomorrow } = localDayBounds();

  const lastVisit = await prisma.opdVisit.findFirst({
    where: {
      visitDate: { gte: today, lt: tomorrow },
    },
    orderBy: { tokenNumber: "desc" },
  });

  const nextToken = lastVisit ? lastVisit.tokenNumber + 1 : 1;

  return res.status(200).json(
    new ApiResponse(200, { nextToken }, "Next token fetched successfully")
  );
});

// ─── Create OPD Visit ──────────────────────────────────────
const createOpdVisit = asyncHandler(async (req, res) => {
  const {
    patientId,
    doctorId,
    symptoms,
    diagnosis,
    paymentMode,
    visitDate,
  } = req.body;

  if (!patientId || !doctorId || !paymentMode) {
    throw new ApiError(400, "patientId, doctorId and paymentMode are required");
  }

  // Check patient
  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) throw new ApiError(404, "Patient not found");

  // Check doctor
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new ApiError(404, "Doctor not found");
  if (doctor.status === "INACTIVE") {
    throw new ApiError(400, "Doctor is inactive");
  }

  const { start: visitDay, end: nextDay } = visitDate
    ? localDayBounds(new Date(visitDate + "T12:00:00"))
    : localDayBounds();

  // Doctor limit check
  const todayCount = await prisma.opdVisit.count({
    where: {
      doctorId,
      visitDate: { gte: visitDay, lt: nextDay },
    },
  });

  if (todayCount >= doctor.opdLimitPerDay) {
    throw new ApiError(
      400,
      `Doctor OPD limit (${doctor.opdLimitPerDay}) reached for today`
    );
  }

  // 🔥 TRANSACTION START
  const opdVisit = await prisma.$transaction(async (tx) => {
    // 1️⃣ Token (daily reset)
    const lastVisit = await tx.opdVisit.findFirst({
      where: { visitDate: { gte: visitDay, lt: nextDay } },
      orderBy: { tokenNumber: "desc" },
    });

    const tokenNumber = lastVisit ? lastVisit.tokenNumber + 1 : 1;

    // 2️⃣ Invoice (never reset)
    const lastInvoice = await tx.opdVisit.findFirst({
      orderBy: { invoiceSeq: "desc" },
      select: { invoiceSeq: true },
    });

    const nextInvoiceSeq = lastInvoice ? lastInvoice.invoiceSeq + 1 : 1;

    const invoiceNumber = String(nextInvoiceSeq).padStart(4, "0");

    // 3️⃣ Create record
    return await tx.opdVisit.create({
      data: {
        patientId,
        doctorId,
        tokenNumber,
        invoiceNumber,
        invoiceSeq: nextInvoiceSeq, // ⚠️ don't forget this
        visitDate: visitDay,
        symptoms,
        diagnosis,
        fee: doctor.consultationFee,
        paymentMode,
        paymentStatus: "PAID",
      },
      include: {
        patient: {
          select: {
            id: true,
            name: true,
            phone: true,
            age: true,
            gender: true,
            aadhar: true,
          },
        },
        doctor: {
          select: {
            id: true,
            name: true,
            specialization: true,
            consultationFee: true,
          },
        },
      },
    });
  });

  return res.status(201).json(
    new ApiResponse(201, opdVisit, "OPD visit registered successfully")
  );
});

// ─── Get All OPD Visits ────────────────────────────────────
const getAllOpdVisits = asyncHandler(async (req, res) => {
  const {
    search,
    doctorId,
    paymentStatus,
    from,
    to,
    page = 1,
    limit = 20,
  } = req.query;

  const where = {};

  if (doctorId) where.doctorId = doctorId;
  if (paymentStatus) where.paymentStatus = paymentStatus;

  // Date filter
  if (from || to) {
    where.visitDate = {};
    if (from) {
      const fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);
      where.visitDate.gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.visitDate.lte = toDate;
    }
  }

  // Search by patient name or phone
  if (search) {
    where.patient = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ],
    };
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [visits, total] = await Promise.all([
    prisma.opdVisit.findMany({
      where,
      include: {
        patient: {
          select: { id: true, name: true, phone: true, age: true, gender: true },
        },
        doctor: {
          select: { id: true, name: true, specialization: true },
        },
      },
      orderBy: [{ visitDate: "desc" }, { invoiceSeq: "desc" }],
      skip,
      take: parseInt(limit),
    }),
    prisma.opdVisit.count({ where }),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      visits,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }, "OPD visits fetched successfully")
  );
});

// ─── Get Today's OPD Visits ────────────────────────────────
const getTodayOpdVisits = asyncHandler(async (req, res) => {
  const { doctorId } = req.query;

  const { start: today, end: tomorrow } = localDayBounds();

  const where = {
    visitDate: { gte: today, lt: tomorrow },
  };
  if (doctorId) where.doctorId = doctorId;

  const visits = await prisma.opdVisit.findMany({
    where,
    include: {
      patient: {
        select: { id: true, name: true, phone: true, age: true, gender: true, address: true },
      },
      doctor: {
        select: { id: true, name: true, specialization: true },
      },
    },
    orderBy: { tokenNumber: "asc" },
  });

  return res.status(200).json(
    new ApiResponse(200, visits, "Today's OPD visits fetched successfully")
  );
});

// ─── Get Single OPD Visit ──────────────────────────────────
const getOpdVisitById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const visit = await prisma.opdVisit.findUnique({
    where: { id },
    include: {
      patient: true,
      doctor: {
        select: { id: true, name: true, specialization: true, consultationFee: true },
      },
      prescription: {
        include: { medicines: true },
      },
    },
  });

  if (!visit) throw new ApiError(404, "OPD visit not found");

  return res.status(200).json(
    new ApiResponse(200, visit, "OPD visit fetched successfully")
  );
});

// ─── Update OPD Visit ──────────────────────────────────────
const updateOpdVisit = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { symptoms, diagnosis, fee, paymentMode, paymentStatus, doctorId } = req.body;

  const visit = await prisma.opdVisit.findUnique({ where: { id } });
  if (!visit) throw new ApiError(404, "OPD visit not found");

  // If doctor is being changed, validate new doctor
  if (doctorId && doctorId !== visit.doctorId) {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) throw new ApiError(404, "Doctor not found");
  }

  // Validate paymentStatus if provided
  if (paymentStatus) {
    const validStatuses = ["PENDING", "PAID", "PARTIAL"];
    if (!validStatuses.includes(paymentStatus)) {
      throw new ApiError(400, `paymentStatus must be one of: ${validStatuses.join(", ")}`);
    }
  }

  // Validate paymentMode if provided
  if (paymentMode) {
    const validModes = ["CASH", "CARD", "UPI", "CHEQUE", "ONLINE", "BANK_TRANSFER"];
    if (!validModes.includes(paymentMode)) {
      throw new ApiError(400, `paymentMode must be one of: ${validModes.join(", ")}`);
    }
  }

  const updated = await prisma.opdVisit.update({
    where: { id },
    data: {
      ...(symptoms !== undefined && { symptoms }),
      ...(diagnosis !== undefined && { diagnosis }),
      ...(fee !== undefined && { fee: parseFloat(fee) }),
      ...(paymentMode !== undefined && { paymentMode }),
      ...(paymentStatus !== undefined && { paymentStatus }),
      ...(doctorId !== undefined && { doctorId }),
    },
    include: {
      patient: { select: { id: true, name: true, phone: true } },
      doctor: { select: { id: true, name: true, specialization: true } },
    },
  });

  return res.status(200).json(new ApiResponse(200, updated, "OPD visit updated successfully"));
});


// ─── Update Payment Status ─────────────────────────────────
const updatePaymentStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { paymentStatus, paymentMode } = req.body;

  if (!paymentStatus) throw new ApiError(400, "paymentStatus is required");

  const validStatuses = ["PENDING", "PAID", "PARTIAL"];
  if (!validStatuses.includes(paymentStatus)) {
    throw new ApiError(400, `paymentStatus must be one of: ${validStatuses.join(", ")}`);
  }

  const visit = await prisma.opdVisit.findUnique({ where: { id } });
  if (!visit) throw new ApiError(404, "OPD visit not found");

  const updated = await prisma.opdVisit.update({
    where: { id },
    data: {
      paymentStatus,
      ...(paymentMode && { paymentMode }),
    },
  });

  return res.status(200).json(
    new ApiResponse(200, updated, "Payment status updated successfully")
  );
});


// ─── Delete OPD Visit (SUPER_ADMIN only) ──────────────────
const deleteOpdVisit = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const visit = await prisma.opdVisit.findUnique({
    where: { id },
    include: { prescription: true },
  });
  if (!visit) throw new ApiError(404, "OPD visit not found");

  // Delete visit — prescriptions cascade via Prisma relation
  await prisma.$transaction(async (tx) => {
    // Delete prescription medicines first, then prescriptions, then visit
    for (const prescription of visit.prescription) {
      await tx.prescriptionMedicine.deleteMany({ where: { prescriptionId: prescription.id } });
    }
    await tx.prescription.deleteMany({ where: { opdVisitId: id } });
    await tx.opdVisit.delete({ where: { id } });
  });

  return res.status(200).json(new ApiResponse(200, {}, "OPD visit deleted successfully"));
});

// ─── Get OPD Slip Data ─────────────────────────────────────
const getOpdSlip = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const visit = await prisma.opdVisit.findUnique({
    where: { id },
    include: {
      patient: true,
      doctor: {
        select: {
          name: true,
          specialization: true,
          consultationFee: true,
        },
      },
    },
  });

  if (!visit) throw new ApiError(404, "OPD visit not found");

  // Get hospital settings for slip header
  const settings = await prisma.hospitalSettings.findFirst();

  // Format aadhar as XXXX-XXXX-1234
  const aadhar = visit.patient.aadhar;
  const maskedAadhar = `XXXX-XXXX-${aadhar.slice(-4)}`;

  const slipData = {
    hospital: {
      name: settings?.name || "Dimag Hospital",
      address: settings?.address || "",
      phone: settings?.phone || "",
      logo: settings?.logo || "",
    },
    token: String(visit.tokenNumber).padStart(4, "0"),
    invoice: visit.invoiceNumber,
    date: visit.visitDate,
    patient: {
      name: visit.patient.name,
      age: visit.patient.age,
      gender: visit.patient.gender,
      phone: visit.patient.phone,
      aadhar: maskedAadhar,
      address: visit.patient.address,
    },
    doctor: {
      name: visit.doctor.name,
      specialization: visit.doctor.specialization,
    },
    fee: visit.fee,
    symptoms: visit.symptoms,
    paymentStatus: visit.paymentStatus,
    paymentMode: visit.paymentMode,
  };

  return res.status(200).json(
    new ApiResponse(200, slipData, "OPD slip data fetched successfully")
  );
});


// ─── Mark OPD as Checked ─────────────────────────────
const markOpdChecked = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { check } = req.body;

  // Validate
  if (typeof check !== "boolean") {
    throw new ApiError(400, "check must be true or false");
  }

  const visit = await prisma.opdVisit.findUnique({
    where: { id },
  });

  if (!visit) {
    throw new ApiError(404, "OPD visit not found");
  }

  const updated = await prisma.opdVisit.update({
    where: { id },
    data: {
      check,
    },
  });

  return res.status(200).json(
    new ApiResponse(200, updated, "Check status updated successfully")
  );
});


module.exports = {
  getNextToken,
  createOpdVisit,
  getAllOpdVisits,
  getTodayOpdVisits,
  getOpdVisitById,
  updateOpdVisit,
  updatePaymentStatus,
  deleteOpdVisit,
  getOpdSlip,
  markOpdChecked,
};