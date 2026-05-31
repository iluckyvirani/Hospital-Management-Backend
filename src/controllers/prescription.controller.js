const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");

// ─── Create Prescription ───────────────────────────────────
const createPrescription = asyncHandler(async (req, res) => {
  const { patientId, opdVisitId, admissionId, notes, medicines } = req.body;
  const prescribedBy = req.user.id;

  if (!patientId) throw new ApiError(400, "patientId is required");
  if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
    throw new ApiError(400, "At least one medicine is required");
  }

  // Validate patient exists
  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) throw new ApiError(404, "Patient not found");

  // Validate OPD visit if provided
  if (opdVisitId) {
    const visit = await prisma.opdVisit.findUnique({ where: { id: opdVisitId } });
    if (!visit) throw new ApiError(404, "OPD visit not found");
  }

  // Validate admission if provided
  if (admissionId) {
    const admission = await prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new ApiError(404, "Admission not found");
  }

  // Validate each medicine entry
  for (const med of medicines) {
    if (!med.medicineName || !med.dosage || !med.form || !med.quantity || !med.frequency || !med.days) {
      throw new ApiError(400, "Each medicine must have medicineName, dosage, form, quantity, frequency, and days");
    }
  }

  const prescription = await prisma.prescription.create({
    data: {
      patientId,
      prescribedBy,
      ...(opdVisitId && { opdVisitId }),
      ...(admissionId && { admissionId }),
      ...(notes && { notes }),
      medicines: {
        create: medicines.map((med) => ({
          medicineName: med.medicineName,
          dosage: med.dosage,
          form: med.form,
          quantity: parseInt(med.quantity),
          frequency: med.frequency,
          days: parseInt(med.days),
          ...(med.instructions && { instructions: med.instructions }),
        })),
      },
    },
    include: {
      medicines: true,
      patient: {
        select: { id: true, name: true, phone: true, age: true, gender: true },
      },
      user: {
        select: { id: true, name: true },
      },
    },
  });

  return res
    .status(201)
    .json(new ApiResponse(201, prescription, "Prescription created successfully"));
});

// ─── Get Prescription By ID ────────────────────────────────
const getPrescriptionById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const prescription = await prisma.prescription.findUnique({
    where: { id },
    include: {
      medicines: true,
      patient: {
        select: { id: true, name: true, phone: true, age: true, gender: true },
      },
      user: {
        select: { id: true, name: true },
      },
      opdVisit: {
        select: { id: true, tokenNumber: true, visitDate: true },
      },
      admission: {
        select: { id: true, admitId: true, admitDate: true },
      },
    },
  });

  if (!prescription) throw new ApiError(404, "Prescription not found");

  return res
    .status(200)
    .json(new ApiResponse(200, prescription, "Prescription fetched successfully"));
});

// ─── Get Prescriptions By Patient ──────────────────────────
const getPatientPrescriptions = asyncHandler(async (req, res) => {
  const { patientId } = req.params;

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) throw new ApiError(404, "Patient not found");

  const prescriptions = await prisma.prescription.findMany({
    where: { patientId },
    include: {
      medicines: true,
      user: {
        select: { id: true, name: true },
      },
      opdVisit: {
        select: { id: true, tokenNumber: true, visitDate: true },
      },
      admission: {
        select: { id: true, admitId: true, admitDate: true },
      },
    },
    orderBy: { prescriptionDate: "desc" },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, prescriptions, "Patient prescriptions fetched successfully"));
});

// ─── Update Prescription ───────────────────────────────────
const updatePrescription = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { notes, medicines } = req.body;

  const existing = await prisma.prescription.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Prescription not found");

  if (medicines && (!Array.isArray(medicines) || medicines.length === 0)) {
    throw new ApiError(400, "At least one medicine is required");
  }

  // Use transaction to delete old medicines and create new ones
  const prescription = await prisma.$transaction(async (tx) => {
    // Delete old medicines if new ones provided
    if (medicines) {
      await tx.prescriptionMedicine.deleteMany({ where: { prescriptionId: id } });
    }

    return tx.prescription.update({
      where: { id },
      data: {
        ...(notes !== undefined && { notes }),
        ...(medicines && {
          medicines: {
            create: medicines.map((med) => ({
              medicineName: med.medicineName,
              dosage: med.dosage,
              form: med.form,
              quantity: parseInt(med.quantity),
              frequency: med.frequency,
              days: parseInt(med.days),
              ...(med.instructions && { instructions: med.instructions }),
            })),
          },
        }),
      },
      include: {
        medicines: true,
        patient: {
          select: { id: true, name: true, phone: true, age: true, gender: true },
        },
        user: {
          select: { id: true, name: true },
        },
      },
    });
  });

  return res
    .status(200)
    .json(new ApiResponse(200, prescription, "Prescription updated successfully"));
});

// ─── Delete Prescription ───────────────────────────────────
const deletePrescription = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await prisma.prescription.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Prescription not found");

  await prisma.prescription.delete({ where: { id } });

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Prescription deleted successfully"));
});

module.exports = {
  createPrescription,
  getPrescriptionById,
  getPatientPrescriptions,
  updatePrescription,
  deletePrescription,
};
