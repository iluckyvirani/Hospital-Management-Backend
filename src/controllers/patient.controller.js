
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");
const { cloudinary } = require("../config/cloudinary");

// ─── Create Patient ────────────────────────────────────────
const createPatient = asyncHandler(async (req, res) => {
  const { name, age, gender, phone, aadhar, address, emergencyContact } = req.body;

  if (!name || !age || !gender || !phone) {
    throw new ApiError(400, "name, age, gender, and phone are required");
  }

  // Validate aadhar — 12 digits
  if (aadhar && !/^\d{12}$/.test(aadhar)) {
    throw new ApiError(400, "Aadhar must be exactly 12 digits");
  }

  // Validate phone — 10 digits
  if (!/^\d{10}$/.test(phone)) {
    throw new ApiError(400, "Phone must be exactly 10 digits");
  }

  // Check duplicate phone
  const existing = await prisma.patient.findUnique({ where: { phone } });
  if (existing) throw new ApiError(409, "Patient with this phone number already exists");

  const patient = await prisma.patient.create({
    data: {
      name,
      age: parseInt(age),
      gender,
      phone,
      aadhar,
      address,
      emergencyContact,
    },
  });

  return res.status(201).json(
    new ApiResponse(201, patient, "Patient created successfully")
  );
});

// ─── Get All Patients ──────────────────────────────────────
const getAllPatients = asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;

  const where = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { aadhar: { contains: search } },
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [patients, total] = await Promise.all([
    prisma.patient.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: parseInt(limit),
      include: {
        _count: {
          select: {
            opdVisits: true,
            admissions: true,
          },
        },
      },
    }),
    prisma.patient.count({ where }),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      patients,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }, "Patients fetched successfully")
  );
});

// ─── Get Single Patient ────────────────────────────────────
const getPatientById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const patient = await prisma.patient.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          opdVisits: true,
          admissions: true,
        },
      },
    },
  });

  if (!patient) throw new ApiError(404, "Patient not found");

  return res.status(200).json(
    new ApiResponse(200, patient, "Patient fetched successfully")
  );
});

// ─── Update Patient ────────────────────────────────────────
const updatePatient = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name, age, gender, phone, aadhar, address,
    emergencyContact, emergencyName, email, bloodGroup, allergies,
  } = req.body;

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) throw new ApiError(404, "Patient not found");

  // Validate phone if provided
  if (phone && !/^\d{10}$/.test(phone)) {
    throw new ApiError(400, "Phone must be exactly 10 digits");
  }

  // Validate aadhar if provided
  if (aadhar && !/^\d{12}$/.test(aadhar)) {
    throw new ApiError(400, "Aadhar must be exactly 12 digits");
  }

  // Check duplicate phone if changed
  if (phone && phone !== patient.phone) {
    const existing = await prisma.patient.findUnique({ where: { phone } });
    if (existing) throw new ApiError(409, "Patient with this phone number already exists");
  }

  const updated = await prisma.patient.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(age && { age: parseInt(age) }),
      ...(gender && { gender }),
      ...(phone && { phone }),
      ...(aadhar && { aadhar }),
      ...(address !== undefined && { address }),
      ...(emergencyContact !== undefined && { emergencyContact }),
      ...(emergencyName !== undefined && { emergencyName }),
      ...(email !== undefined && { email }),
      ...(bloodGroup !== undefined && { bloodGroup }),
      ...(allergies !== undefined && { allergies }),
    },
  });

  return res.status(200).json(
    new ApiResponse(200, updated, "Patient updated successfully")
  );
});

// ─── Delete Patient ────────────────────────────────────────
const deletePatient = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) throw new ApiError(404, "Patient not found");

  // Get all admission IDs for this patient
  const admissions = await prisma.admission.findMany({
    where: { patientId: id },
    select: { id: true },
  });
  const admissionIds = admissions.map((a) => a.id);

  // Use a transaction to delete all related records in the correct order
  await prisma.$transaction(async (tx) => {
    // 1. Delete medical reports
    await tx.medicalReport.deleteMany({ where: { patientId: id } });

    // 2. Delete prescriptions (PrescriptionMedicines cascade automatically)
    await tx.prescription.deleteMany({ where: { patientId: id } });

    // 3. Delete OPD visits
    await tx.opdVisit.deleteMany({ where: { patientId: id } });

    // 4. Delete admission-related records that don't cascade
    if (admissionIds.length > 0) {
      await tx.finalBill.deleteMany({ where: { admissionId: { in: admissionIds } } });
      await tx.dischargeCard.deleteMany({ where: { admissionId: { in: admissionIds } } });
    }

    // 5. Delete admissions (Deposits, PatientServices, MedicalForms cascade)
    await tx.admission.deleteMany({ where: { patientId: id } });

    // 6. Delete patient
    await tx.patient.delete({ where: { id } });
  });

  return res.status(200).json(
    new ApiResponse(200, {}, "Patient deleted successfully")
  );
});

// ─── Get Patient OPD History ───────────────────────────────
const getPatientOpdHistory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) throw new ApiError(404, "Patient not found");

  const opdVisits = await prisma.opdVisit.findMany({
    where: { patientId: id },
    include: {
      doctor: {
        select: { name: true, specialization: true },
      },
    },
    orderBy: { visitDate: "desc" },
  });

  return res.status(200).json(
    new ApiResponse(200, opdVisits, "OPD history fetched successfully")
  );
});

// ─── Get Patient Admit History ─────────────────────────────
const getPatientAdmitHistory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) throw new ApiError(404, "Patient not found");

  const admissions = await prisma.admission.findMany({
    where: { patientId: id },
    include: {
      doctor: { select: { name: true, specialization: true } },
      room: { include: { roomType: true } },
      bed: true,
      finalBill: true,
    },
    orderBy: { admissionDate: "desc" },
  });

  return res.status(200).json(
    new ApiResponse(200, admissions, "Admit history fetched successfully")
  );
});

// ─── Get Patient Prescription History ──────────────────────
const getPatientMedicineHistory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) throw new ApiError(404, "Patient not found");

  const prescriptions = await prisma.prescription.findMany({
    where: { patientId: id },
    include: {
      medicines: true,
      user: { select: { name: true } },
    },
    orderBy: { prescriptionDate: "desc" },
  });

  return res.status(200).json(
    new ApiResponse(200, prescriptions, "Prescription history fetched successfully")
  );
});

// ─── Get Patient Service History ───────────────────────────
const getPatientServiceHistory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) throw new ApiError(404, "Patient not found");

  const services = await prisma.patientService.findMany({
    where: { admission: { patientId: id } },
    include: {
      service: true,
      admission: { select: { admitId: true, admissionDate: true } },
      user: { select: { name: true } },
    },
    orderBy: { serviceDate: "desc" },
  });

  return res.status(200).json(
    new ApiResponse(200, services, "Service history fetched successfully")
  );
});

// ─── Get Patient Payment History ───────────────────────────
const getPatientPaymentHistory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) throw new ApiError(404, "Patient not found");

  // OPD payments
  const opdPayments = await prisma.opdVisit.findMany({
    where: { patientId: id, paymentStatus: "PAID" },
    select: {
      id: true,
      visitDate: true,
      fee: true,
      paymentMode: true,
      paymentStatus: true,
    },
  });

  // Deposits
  const deposits = await prisma.deposit.findMany({
    where: { admission: { patientId: id } },
    include: {
      admission: { select: { admitId: true } },
    },
    orderBy: { paymentDate: "desc" },
  });

  // Final bills
  const finalBills = await prisma.finalBill.findMany({
    where: { admission: { patientId: id } },
    include: {
      admission: { select: { admitId: true } },
    },
  });

  return res.status(200).json(
    new ApiResponse(200, {
      opdPayments,
      deposits,
      finalBills,
    }, "Payment history fetched successfully")
  );
});

// ─── Upload Medical Report ─────────────────────────────────
const uploadMedicalReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reportName, reportType, admissionId } = req.body;

  if (!reportName || !reportType) {
    throw new ApiError(400, "reportName and reportType are required");
  }

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) throw new ApiError(404, "Patient not found");

  if (!req.file) throw new ApiError(400, "Report file is required");

  const report = await prisma.medicalReport.create({
    data: {
      patientId: id,
      admissionId: admissionId || null,
      reportName,
      reportType,
      filePath: req.file.path,
      uploadedBy: req.user.id,
    },
  });

  return res.status(201).json(
    new ApiResponse(201, report, "Medical report uploaded successfully")
  );
});

// ─── Get Medical Reports ───────────────────────────────────
const getMedicalReports = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) throw new ApiError(404, "Patient not found");

  const reports = await prisma.medicalReport.findMany({
    where: { patientId: id },
    orderBy: { uploadedAt: "desc" },
  });

  return res.status(200).json(
    new ApiResponse(200, reports, "Medical reports fetched successfully")
  );
});

// ─── Delete Medical Report ─────────────────────────────────
const deleteMedicalReport = asyncHandler(async (req, res) => {
  const { id, reportId } = req.params;

  const report = await prisma.medicalReport.findUnique({ where: { id: reportId } });
  if (!report) throw new ApiError(404, "Report not found");

  // Delete file from Cloudinary
  if (report.filePath) {
    const publicId = report.filePath.split("/").pop().split(".")[0];
    await cloudinary.uploader.destroy(`dimag-hospital/${publicId}`);
  }

  await prisma.medicalReport.delete({ where: { id: reportId } });

  return res.status(200).json(
    new ApiResponse(200, {}, "Medical report deleted successfully")
  );
});



module.exports = {
  createPatient,
  getAllPatients,
  getPatientById,
  updatePatient,
  deletePatient,
  getPatientOpdHistory,
  getPatientAdmitHistory,
  getPatientMedicineHistory,
  getPatientServiceHistory,
  getPatientPaymentHistory,
  uploadMedicalReport,
  getMedicalReports,
  deleteMedicalReport,
};