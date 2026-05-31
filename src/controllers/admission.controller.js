const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");

// ─── Admit Patient ─────────────────────────────────────────
const admitPatient = asyncHandler(async (req, res) => {
  const {
    patientId,
    doctorId,
    roomId,
    bedId,
    admissionDate,
    expectedDischarge,
    diagnosis,
    initialDeposit,
    paymentMode,
  } = req.body;

  if (!patientId || !doctorId || !roomId || !bedId || !diagnosis) {
    throw new ApiError(400, "patientId, doctorId, roomId, bedId and diagnosis are required");
  }

  // Verify patient exists
  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) throw new ApiError(404, "Patient not found");

  // Verify doctor exists
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new ApiError(404, "Doctor not found");

  // Verify bed is available
  const bed = await prisma.bed.findUnique({ where: { id: bedId } });
  if (!bed) throw new ApiError(404, "Bed not found");
  if (bed.status !== "AVAILABLE") throw new ApiError(400, "Bed is not available");

  // Generate admit ID: IPD + YYYYMMDD + 3-digit seq
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  const todayCount = await prisma.admission.count({
    where: { createdAt: { gte: startOfDay, lte: endOfDay } },
  });
  const admitId = `IPD${dateStr}${String(todayCount + 1).padStart(3, "0")}`;

  // Create admission + mark bed occupied + optional deposit in transaction
  const result = await prisma.$transaction(async (tx) => {
    const admission = await tx.admission.create({
      data: {
        admitId,
        patientId,
        doctorId,
        roomId,
        bedId,
        admissionDate: admissionDate ? new Date(admissionDate) : new Date(),
        expectedDischarge: expectedDischarge ? new Date(expectedDischarge) : null,
        diagnosis,
        status: "ADMITTED",
      },
      include: {
        patient: { select: { id: true, name: true, phone: true, age: true, gender: true } },
        doctor: { select: { id: true, name: true, specialization: true } },
        room: { include: { roomType: true } },
        bed: true,
      },
    });

    // Mark bed as occupied
    await tx.bed.update({
      where: { id: bedId },
      data: { status: "OCCUPIED" },
    });

    // Create initial deposit if provided
    if (initialDeposit && parseFloat(initialDeposit) > 0) {
      const lastDep = await tx.deposit.findFirst({ orderBy: { createdAt: "desc" } });
      let nextSeq = 1;
      if (lastDep && lastDep.receiptNumber) {
        const match = lastDep.receiptNumber.match(/(\d+)$/);
        if (match) nextSeq = parseInt(match[1], 10) + 1;
      }
      const receiptNumber = `DEP-${today.getFullYear()}-${String(nextSeq).padStart(4, "0")}`;

      await tx.deposit.create({
        data: {
          admissionId: admission.id,
          amount: parseFloat(initialDeposit),
          paymentMode: paymentMode || "CASH",
          receiptNumber,
        },
      });
    }

    return admission;
  });

  // Fetch the admission again with deposits for the response
  const finalAdmission = await prisma.admission.findUnique({
    where: { id: result.id },
    include: {
      patient: { select: { id: true, name: true, phone: true, age: true, gender: true } },
      doctor: { select: { id: true, name: true, specialization: true } },
      room: { include: { roomType: true } },
      bed: true,
      deposits: { orderBy: { createdAt: "desc" } },
    },
  });

  return res.status(201).json(
    new ApiResponse(201, finalAdmission, "Patient admitted successfully")
  );
});

// ─── Get All IPD Patients ──────────────────────────────────
const getAllAdmissions = asyncHandler(async (req, res) => {
  const { search, status, roomType, from, to, page = 1, limit = 20 } = req.query;

  const where = {};
  if (status) where.status = status;
  if (roomType) {
    where.room = { roomType: { type: roomType } };
  }
  if (from || to) {
    where.admissionDate = {};
    if (from) {
      const fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);
      where.admissionDate.gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.admissionDate.lte = toDate;
    }
  }
  if (search) {
    where.OR = [
      { patient: { name: { contains: search, mode: "insensitive" } } },
      { patient: { phone: { contains: search } } },
      { admitId: { contains: search, mode: "insensitive" } },
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [admissions, total] = await Promise.all([
    prisma.admission.findMany({
      where,
      include: {
        patient: { select: { id: true, name: true, phone: true, age: true, gender: true } },
        doctor: { select: { id: true, name: true, specialization: true } },
        room: { include: { roomType: true } },
        bed: true,
        deposits: true,
        finalBill: true,
      },
      orderBy: { admissionDate: "desc" },
      skip,
      take: parseInt(limit),
    }),
    prisma.admission.count({ where }),
  ]);

  // Calculate total deposits for each admission
  const enriched = admissions.map((a) => ({
    ...a,
    totalDeposits: a.deposits.reduce((sum, d) => sum + parseFloat(d.amount), 0),
  }));

  return res.status(200).json(
    new ApiResponse(200, {
      admissions: enriched,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }, "Admissions fetched successfully")
  );
});

// ─── Get Single Admission ──────────────────────────────────
const getAdmissionById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const admission = await prisma.admission.findUnique({
    where: { id },
    include: {
      patient: true,
      doctor: { select: { id: true, name: true, specialization: true } },
      room: { include: { roomType: true } },
      bed: true,
      deposits: { orderBy: { paymentDate: "desc" } },
      patientServices: { include: { service: true } },
      finalBill: true,
      dischargeCard: true,
    },
  });

  if (!admission) throw new ApiError(404, "Admission not found");

  return res.status(200).json(
    new ApiResponse(200, admission, "Admission fetched successfully")
  );
});

 
// ─── Update Admission (SUPER_ADMIN full edit) ──────────────
const updateAdmission = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { doctorId, roomId, bedId, diagnosis, expectedDischarge, admissionDate, status, actualDischarge } = req.body;
 
  const admission = await prisma.admission.findUnique({
    where: { id },
    include: { bed: true },
  });
  if (!admission) throw new ApiError(404, "Admission not found");

  // For discharged admissions, only allow updating actualDischarge and admissionDate
  if (admission.status === "DISCHARGED") {
    if (doctorId || roomId || bedId || diagnosis || expectedDischarge || status) {
      throw new ApiError(400, "Discharged admission: only admission date and actual discharge date can be edited");
    }

    const updateData = {};
    if (actualDischarge !== undefined) {
      const dischDate = new Date(actualDischarge);
      const admitDate = new Date(admission.admissionDate);
      if (dischDate < admitDate) throw new ApiError(400, "Discharge date cannot be before admission date");
      const today = new Date(); today.setHours(23, 59, 59, 999);
      if (dischDate > today) throw new ApiError(400, "Discharge date cannot be in the future");
      updateData.actualDischarge = dischDate;
    }
    if (admissionDate !== undefined) {
      const newAdmitDate = new Date(admissionDate);
      if (admission.actualDischarge && newAdmitDate > new Date(admission.actualDischarge)) {
        throw new ApiError(400, "Admission date cannot be after discharge date");
      }
      updateData.admissionDate = newAdmitDate;
    }

    const updated = await prisma.admission.update({
      where: { id },
      data: updateData,
      include: {
        patient: { select: { id: true, name: true, phone: true, age: true, gender: true } },
        doctor:  { select: { id: true, name: true, specialization: true } },
        room:    { include: { roomType: true } },
        bed: true,
      },
    });
    return res.status(200).json(new ApiResponse(200, updated, "Admission updated successfully"));
  }
 
  // If bed is being changed — validate new bed and swap old bed back to AVAILABLE
  if (bedId && bedId !== admission.bedId) {
    const newBed = await prisma.bed.findUnique({ where: { id: bedId } });
    if (!newBed) throw new ApiError(404, "New bed not found");
    if (newBed.status !== "AVAILABLE") throw new ApiError(400, "New bed is not available");
  }
 
  // Validate doctor if changing
  if (doctorId && doctorId !== admission.doctorId) {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) throw new ApiError(404, "Doctor not found");
  }
 
  // Validate status if changing
  if (status) {
    const validStatuses = ["ADMITTED", "CRITICAL", "READY_FOR_DISCHARGE", "DISCHARGED"];
    if (!validStatuses.includes(status)) {
      throw new ApiError(400, `status must be one of: ${validStatuses.join(", ")}`);
    }
  }
 
  const updated = await prisma.$transaction(async (tx) => {
    // Handle bed swap
    if (bedId && bedId !== admission.bedId) {
      // Free old bed
      await tx.bed.update({ where: { id: admission.bedId }, data: { status: "AVAILABLE" } });
      // Occupy new bed
      await tx.bed.update({ where: { id: bedId }, data: { status: "OCCUPIED" } });
    }
 
    return tx.admission.update({
      where: { id },
      data: {
        ...(doctorId          !== undefined && { doctorId }),
        ...(roomId            !== undefined && { roomId }),
        ...(bedId             !== undefined && { bedId }),
        ...(diagnosis         !== undefined && { diagnosis }),
        ...(status            !== undefined && { status }),
        ...(expectedDischarge !== undefined && { expectedDischarge: expectedDischarge ? new Date(expectedDischarge) : null }),
        ...(admissionDate     !== undefined && { admissionDate: new Date(admissionDate) }),
      },
      include: {
        patient: { select: { id: true, name: true, phone: true, age: true, gender: true } },
        doctor:  { select: { id: true, name: true, specialization: true } },
        room:    { include: { roomType: true } },
        bed: true,
      },
    });
  });
 
  return res.status(200).json(new ApiResponse(200, updated, "Admission updated successfully"));
});

// ─── Delete Admission (SUPER_ADMIN only) ──────────────────
const deleteAdmission = asyncHandler(async (req, res) => {
  const { id } = req.params;
 
  const admission = await prisma.admission.findUnique({
    where: { id },
    include: {
      bed: true,
      deposits: true,
      patientServices: true,
      finalBill: true,
      prescriptions: true,
      dischargeCard: true,
      medicalForms: true,
    },
  });
  if (!admission) throw new ApiError(404, "Admission not found");
 
  await prisma.$transaction(async (tx) => {
    // 1. Free the bed
    await tx.bed.update({
      where: { id: admission.bedId },
      data: { status: "AVAILABLE" },
    });
 
    // 2. Delete medical forms
    await tx.medicalForm.deleteMany({ where: { admissionId: id } });
 
    // 3. Delete discharge card
    await tx.dischargeCard.deleteMany({ where: { admissionId: id } });
 
    // 4. Delete final bill
    await tx.finalBill.deleteMany({ where: { admissionId: id } });
 
    // 5. Delete deposits
    await tx.deposit.deleteMany({ where: { admissionId: id } });
 
    // 6. Delete patient services
    await tx.patientService.deleteMany({ where: { admissionId: id } });
 
    // 7. Delete prescription medicines then prescriptions
    for (const prescription of admission.prescriptions) {
      await tx.prescriptionMedicine.deleteMany({ where: { prescriptionId: prescription.id } });
    }
    await tx.prescription.deleteMany({ where: { admissionId: id } });
 
    // 8. Finally delete the admission
    await tx.admission.delete({ where: { id } });
  });
 
  return res.status(200).json(new ApiResponse(200, {}, "Admission and all related records deleted successfully"));
});
 


// ─── Add Deposit ───────────────────────────────────────────
const addDeposit = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { amount, paymentMode, notes, paymentDate } = req.body;

  if (!amount || !paymentMode) {
    throw new ApiError(400, "amount and paymentMode are required");
  }

  const admission = await prisma.admission.findUnique({ where: { id } });
  if (!admission) throw new ApiError(404, "Admission not found");
  if (admission.status === "DISCHARGED") throw new ApiError(400, "Cannot add deposit to discharged patient");

  const lastDep = await prisma.deposit.findFirst({ orderBy: { createdAt: "desc" } });
  let nextSeq = 1;
  if (lastDep && lastDep.receiptNumber) {
    const match = lastDep.receiptNumber.match(/(\d+)$/);
    if (match) nextSeq = parseInt(match[1], 10) + 1;
  }
  const receiptNumber = `DEP-${new Date().getFullYear()}-${String(nextSeq).padStart(4, "0")}`;

  const deposit = await prisma.deposit.create({
    data: {
      admissionId: id,
      amount: parseFloat(amount),
      paymentMode,
      receiptNumber,
      notes,
      ...(paymentDate && { paymentDate: new Date(paymentDate) }),
    },
  });

  return res.status(201).json(
    new ApiResponse(201, deposit, "Deposit added successfully")
  );
});


// ─── Update Deposit (SUPER_ADMIN) + recalculate final bill ─
const updateDeposit = asyncHandler(async (req, res) => {
  const { depositId } = req.params;
  const { amount, paymentMode, notes } = req.body;
 
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw new ApiError(404, "Deposit not found");
 
  const updatedDeposit = await prisma.deposit.update({
    where: { id: depositId },
    data: {
      ...(amount      !== undefined && { amount: parseFloat(amount) }),
      ...(paymentMode !== undefined && { paymentMode }),
      ...(notes       !== undefined && { notes }),
    },
  });
 
  // ── Recalculate final bill if it exists ──────────────────
  const finalBill = await prisma.finalBill.findUnique({
    where: { admissionId: deposit.admissionId },
  });
 
  if (finalBill) {
    // Get all deposits for this admission (fresh totals)
    const allDeposits = await prisma.deposit.findMany({
      where: { admissionId: deposit.admissionId },
    });
    const totalDeposits = allDeposits.reduce((sum, d) => sum + parseFloat(d.amount), 0);
    const balanceDue    = Math.max(0, parseFloat(finalBill.grossTotal) - totalDeposits);
    const refundAmount  = Math.max(0, totalDeposits - parseFloat(finalBill.grossTotal));
 
    await prisma.finalBill.update({
      where: { admissionId: deposit.admissionId },
      data: {
        totalDeposits,
        balanceDue,
        refundAmount,
        paymentStatus: balanceDue <= 0 ? "PAID" : "PENDING",
      },
    });
  }
 
  return res.status(200).json(new ApiResponse(200, updatedDeposit, "Deposit updated successfully"));
});
 
// ─── Delete Deposit (SUPER_ADMIN) + recalculate final bill ─
const deleteDeposit = asyncHandler(async (req, res) => {
  const { depositId } = req.params;
 
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw new ApiError(404, "Deposit not found");
 
  await prisma.deposit.delete({ where: { id: depositId } });
 
  // ── Recalculate final bill if it exists ──────────────────
  const finalBill = await prisma.finalBill.findUnique({
    where: { admissionId: deposit.admissionId },
  });
 
  if (finalBill) {
    const allDeposits = await prisma.deposit.findMany({
      where: { admissionId: deposit.admissionId },
    });
    const totalDeposits = allDeposits.reduce((sum, d) => sum + parseFloat(d.amount), 0);
    const balanceDue    = Math.max(0, parseFloat(finalBill.grossTotal) - totalDeposits);
    const refundAmount  = Math.max(0, totalDeposits - parseFloat(finalBill.grossTotal));
 
    await prisma.finalBill.update({
      where: { admissionId: deposit.admissionId },
      data: {
        totalDeposits,
        balanceDue,
        refundAmount,
        paymentStatus: balanceDue <= 0 ? "PAID" : "PENDING",
      },
    });
  }
 
  return res.status(200).json(new ApiResponse(200, {}, "Deposit deleted and bill recalculated successfully"));
});
 


// ─── Discharge Patient ─────────────────────────────────────
const dischargePatient = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    diagnosis,
    conditionOnAdmission,
    conditionOnDischarge,
    treatmentGiven,
    investigations,
    medicinesOnDischarge,
    dietaryAdvice,
    followUpDate,
    followUpInstructions,
    emergencyInstructions,
    additionalNotes,
    dischargeDate,
  } = req.body;

  const admission = await prisma.admission.findUnique({
    where: { id },
    include: { bed: true },
  });

  if (!admission) throw new ApiError(404, "Admission not found");
  if (admission.status === "DISCHARGED") throw new ApiError(400, "Patient already discharged");

  // Use provided discharge date or default to now
  const actualDischargeDate = dischargeDate ? new Date(dischargeDate) : new Date();

  // Validate: discharge date cannot be before admission date
  if (actualDischargeDate < new Date(admission.admissionDate)) {
    throw new ApiError(400, "Discharge date cannot be before admission date");
  }
  // Validate: discharge date cannot be in the future
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (actualDischargeDate > today) {
    throw new ApiError(400, "Discharge date cannot be in the future");
  }

  const result = await prisma.$transaction(async (tx) => {
    // Update admission status
    const updated = await tx.admission.update({
      where: { id },
      data: {
        status: "DISCHARGED",
        actualDischarge: actualDischargeDate,
      },
      include: {
        patient: true,
        doctor: { select: { id: true, name: true, specialization: true } },
        room: { include: { roomType: true } },
        bed: true,
      },
    });

    // Free the bed
    await tx.bed.update({
      where: { id: admission.bedId },
      data: { status: "CLEANING" },
    });

    // Create discharge card
    const dischargeCard = await tx.dischargeCard.create({
      data: {
        admissionId: id,
        diagnosis: diagnosis || admission.diagnosis,
        conditionOnAdmission,
        conditionOnDischarge,
        treatmentGiven,
        investigations: investigations || [],
        medicinesOnDischarge: medicinesOnDischarge || [],
        dietaryAdvice,
        followUpDate: followUpDate ? new Date(followUpDate) : null,
        followUpInstructions,
        emergencyInstructions,
        additionalNotes,
      },
    });

    return { admission: updated, dischargeCard };
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Patient discharged successfully")
  );
});



// ─── Get Discharge Card ────────────────────────────────────
const getDischargeCard = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const dischargeCard = await prisma.dischargeCard.findUnique({
    where: { admissionId: id },
    include: {
      admission: {
        include: {
          patient: true,
          doctor: { select: { name: true, specialization: true } },
          room: { include: { roomType: true } },
          bed: true,
        },
      },
    },
  });

  if (!dischargeCard) throw new ApiError(404, "Discharge card not found");

  return res.status(200).json(
    new ApiResponse(200, dischargeCard, "Discharge card fetched successfully")
  );
});

// ─── Get Deposit Slip ──────────────────────────────────────
const getDepositSlip = asyncHandler(async (req, res) => {
  const { depositId } = req.params;

  const deposit = await prisma.deposit.findUnique({
    where: { id: depositId },
    include: {
      admission: {
        include: {
          patient: true,
          doctor: { select: { id: true, name: true, specialization: true } },
          room: { include: { roomType: true } },
          bed: true,
        },
      },
    },
  });

  if (!deposit) throw new ApiError(404, "Deposit not found");

  return res.status(200).json(
    new ApiResponse(200, deposit, "Deposit slip fetched successfully")
  );
});

// ─── Save Medical Form ────────────────────────────────────────
const saveMedicalForm = asyncHandler(async (req, res) => {
  const { id: admissionId } = req.params;
  const { sections } = req.body;
  const userId = req.user.id;

  if (!sections || typeof sections !== "object") {
    throw new ApiError(400, "sections object is required");
  }

  // Verify admission exists
  const admission = await prisma.admission.findUnique({ where: { id: admissionId } });
  if (!admission) throw new ApiError(404, "Admission not found");

  // Create or update medical form - single entry per admission
  const medicalForm = await prisma.medicalForm.upsert({
    where: { admissionId },
    update: {
      sections,
      updatedAt: new Date(),
    },
    create: {
      admissionId,
      sections,
      createdBy: userId,
    },
  });

  return res.status(200).json(
    new ApiResponse(200, medicalForm, "Medical form saved successfully")
  );
});

// ─── Get Medical Forms ────────────────────────────────────────
const getMedicalForms = asyncHandler(async (req, res) => {
  const { id: admissionId } = req.params;

  const medicalForm = await prisma.medicalForm.findUnique({
    where: { admissionId },
    include: {
      createdByUser: { select: { id: true, name: true } },
    },
  });

  return res.status(200).json(
    new ApiResponse(200, medicalForm || { admissionId, sections: {} }, "Medical form fetched successfully")
  );
});

// ─── Get Single Medical Form ──────────────────────────────────
const getMedicalForm = asyncHandler(async (req, res) => {
  const { id: admissionId } = req.params;

  const medicalForm = await prisma.medicalForm.findUnique({
    where: { admissionId },
    include: {
      admission: {
        include: {
          patient: true,
          doctor: { select: { name: true, specialization: true } },
          room: { include: { roomType: true } },
          bed: true,
        },
      },
      createdByUser: { select: { id: true, name: true } },
    },
  });

  if (!medicalForm) throw new ApiError(404, "Medical form not found");

  return res.status(200).json(
    new ApiResponse(200, medicalForm, "Medical form fetched successfully")
  );
});

// ─── Delete Medical Form ──────────────────────────────────────
const deleteMedicalForm = asyncHandler(async (req, res) => {
  const { id: admissionId } = req.params;
  const userId = req.user.id;

  const medicalForm = await prisma.medicalForm.findUnique({
    where: { admissionId },
  });

  if (!medicalForm) throw new ApiError(404, "Medical form not found");

  // Only creator or admin can delete
  if (medicalForm.createdBy !== userId && req.user.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "You don't have permission to delete this form");
  }

  await prisma.medicalForm.delete({
    where: { admissionId },
  });

  return res.status(200).json(
    new ApiResponse(200, null, "Medical form deleted successfully")
  );
});




module.exports = {
  admitPatient,
  getAllAdmissions,
  getAdmissionById,
  updateAdmission,
  deleteAdmission,
  addDeposit,
  deleteDeposit,
  updateDeposit,
  dischargePatient,
  getDischargeCard,
  getDepositSlip,
  saveMedicalForm,
  getMedicalForms,
  getMedicalForm,
  deleteMedicalForm,
};
