const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");

// ─── Get Report by Type ────────────────────────────────────
const getReport = asyncHandler(async (req, res) => {
  const { type } = req.params;
  const { from, to, range } = req.query;

  // Determine date range
  const { startDate, endDate } = getDateRange(from, to, range);

  let data;
  switch (type) {
    case "revenue":
      data = await getRevenueReport(startDate, endDate);
      break;
    case "patient":
      data = await getPatientReport(startDate, endDate);
      break;
    case "financial":
      data = await getFinancialReport(startDate, endDate);
      break;
    case "operational":
      data = await getOperationalReport(startDate, endDate);
      break;
    default:
      throw new ApiError(400, "Invalid report type. Must be: revenue, patient, financial, operational");
  }

  return res.status(200).json(
    new ApiResponse(200, data, `${type} report fetched successfully`)
  );
});

// ─── Helper: Get Date Range ────────────────────────────────
function getDateRange(from, to, range) {
  const now = new Date();
  let startDate, endDate;

  if (from && to) {
    startDate = new Date(from);
    endDate = new Date(to);
    endDate.setHours(23, 59, 59, 999);
  } else {
    endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    switch (range) {
      case "today":
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "yesterday":
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);
        break;
      case "this-week":
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - startDate.getDay());
        startDate.setHours(0, 0, 0, 0);
        break;
      case "this-year":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case "this-month":
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }
  }

  return { startDate, endDate };
}

// ─── Revenue Report ────────────────────────────────────────
async function getRevenueReport(startDate, endDate) {
  const dateFilter = { gte: startDate, lte: endDate };

  const [opdRevenue, ipdRevenue, serviceRevenue] = await Promise.all([
    prisma.opdVisit.aggregate({
      where: { visitDate: dateFilter, paymentStatus: "PAID" },
      _sum: { fee: true },
    }),
    prisma.finalBill.aggregate({
      where: { generatedDate: dateFilter, paymentStatus: "PAID" },
      _sum: { grossTotal: true },
    }),
    prisma.patientService.aggregate({
      where: { serviceDate: dateFilter },
      _sum: { totalFee: true },
    }),
  ]);

  const opdTotal = parseFloat(opdRevenue._sum.fee || 0);
  const ipdTotal = parseFloat(ipdRevenue._sum.grossTotal || 0);
  const serviceTotal = parseFloat(serviceRevenue._sum.totalFee || 0);

  // Daily data for chart
  const opdDaily = await prisma.opdVisit.groupBy({
    by: ["visitDate"],
    where: { visitDate: dateFilter, paymentStatus: "PAID" },
    _sum: { fee: true },
  });

  // Doctor-wise revenue
  const doctorWise = await prisma.opdVisit.groupBy({
    by: ["doctorId"],
    where: { visitDate: dateFilter, paymentStatus: "PAID" },
    _sum: { fee: true },
    _count: true,
  });

  const doctors = await prisma.doctor.findMany({
    select: { id: true, name: true, specialization: true },
  });
  const doctorMap = Object.fromEntries(doctors.map((d) => [d.id, d]));

  // Payment mode breakdown
  const paymentModes = await prisma.opdVisit.groupBy({
    by: ["paymentMode"],
    where: { visitDate: dateFilter, paymentStatus: "PAID" },
    _sum: { fee: true },
  });

  const totalRevenue = opdTotal + ipdTotal + serviceTotal;

  return {
    summary: {
      opdRevenue: opdTotal,
      ipdRevenue: ipdTotal,
      serviceRevenue: serviceTotal,
      totalRevenue,
    },
    dailyData: opdDaily.map((d) => ({
      date: d.visitDate,
      opd: parseFloat(d._sum.fee || 0),
    })),
    doctorWise: doctorWise.map((d) => ({
      name: doctorMap[d.doctorId]?.name || "Unknown",
      specialization: doctorMap[d.doctorId]?.specialization || "",
      opd: parseFloat(d._sum.fee || 0),
      patients: d._count,
    })),
    paymentModes: paymentModes.map((pm) => ({
      mode: pm.paymentMode,
      amount: parseFloat(pm._sum.fee || 0),
      percentage: totalRevenue > 0 ? ((parseFloat(pm._sum.fee || 0) / totalRevenue) * 100).toFixed(1) : 0,
    })),
  };
}

// ─── Patient Report ────────────────────────────────────────
async function getPatientReport(startDate, endDate) {
  const dateFilter = { gte: startDate, lte: endDate };

  const [
    totalPatients,
    newPatients,
    opdVisits,
    ipdAdmissions,
    discharges,
  ] = await Promise.all([
    prisma.patient.count(),
    prisma.patient.count({ where: { createdAt: dateFilter } }),
    prisma.opdVisit.count({ where: { visitDate: dateFilter } }),
    prisma.admission.count({ where: { admissionDate: dateFilter } }),
    prisma.admission.count({ where: { actualDischarge: dateFilter } }),
  ]);

  // OPD Register
  const opdRegister = await prisma.opdVisit.findMany({
    where: { visitDate: dateFilter },
    include: {
      patient: { select: { name: true, age: true, phone: true } },
      doctor: { select: { name: true } },
    },
    orderBy: { visitDate: "desc" },
    take: 50,
  });

  // IPD Register
  const ipdRegister = await prisma.admission.findMany({
    where: { admissionDate: dateFilter },
    include: {
      patient: { select: { name: true } },
      doctor: { select: { name: true } },
      room: { include: { roomType: true } },
    },
    orderBy: { admissionDate: "desc" },
    take: 50,
  });

  // Discharges
  const dischargeList = await prisma.admission.findMany({
    where: { actualDischarge: dateFilter },
    include: {
      patient: { select: { name: true } },
      doctor: { select: { name: true } },
      room: { include: { roomType: true } },
      finalBill: true,
    },
    orderBy: { actualDischarge: "desc" },
    take: 50,
  });

  return {
    summary: {
      totalPatients,
      newPatients,
      opdVisits,
      ipdAdmissions,
      discharges,
      readmissions: 0,
    },
    opdRegister: opdRegister.map((v) => ({
      token: v.tokenNumber,
      name: v.patient.name,
      age: v.patient.age,
      phone: v.patient.phone,
      doctor: v.doctor.name,
      fee: parseFloat(v.fee),
      date: v.visitDate,
      status: v.paymentStatus,
    })),
    ipdRegister: ipdRegister.map((a) => ({
      admitId: a.admitId,
      name: a.patient.name,
      room: a.room.roomNumber,
      doctor: a.doctor.name,
      admitDate: a.admissionDate,
      days: Math.ceil((new Date() - new Date(a.admissionDate)) / (1000 * 60 * 60 * 24)),
      status: a.status,
    })),
    discharges: dischargeList.map((a) => ({
      admitId: a.admitId,
      name: a.patient.name,
      room: a.room.roomNumber,
      doctor: a.doctor.name,
      admitDate: a.admissionDate,
      dischargeDate: a.actualDischarge,
      totalBill: a.finalBill ? parseFloat(a.finalBill.grossTotal) : 0,
    })),
  };
}

// ─── Financial Report ──────────────────────────────────────
async function getFinancialReport(startDate, endDate) {
  const dateFilter = { gte: startDate, lte: endDate };

  // Revenue breakdown
  const [opdRev, ipdRev, serviceRev] = await Promise.all([
    prisma.opdVisit.aggregate({
      where: { visitDate: dateFilter, paymentStatus: "PAID" },
      _sum: { fee: true },
    }),
    prisma.finalBill.aggregate({
      where: { generatedDate: dateFilter },
      _sum: { grossTotal: true },
    }),
    prisma.patientService.aggregate({
      where: { serviceDate: dateFilter },
      _sum: { totalFee: true },
    }),
  ]);

  // Expense breakdown by category
  const expensesByCategory = await prisma.expense.groupBy({
    by: ["categoryId"],
    where: { expenseDate: dateFilter },
    _sum: { amount: true },
  });

  const categories = await prisma.expenseCategory.findMany();
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  const expenseBreakdown = {};
  let totalExpenses = 0;
  expensesByCategory.forEach((e) => {
    const name = catMap[e.categoryId] || "other";
    const amount = parseFloat(e._sum.amount || 0);
    expenseBreakdown[name.toLowerCase()] = amount;
    totalExpenses += amount;
  });

  const totalRevenue = parseFloat(opdRev._sum.fee || 0) +
    parseFloat(ipdRev._sum.grossTotal || 0) +
    parseFloat(serviceRev._sum.totalFee || 0);

  const netProfit = totalRevenue - totalExpenses;

  // Outstanding bills
  const outstanding = await prisma.finalBill.findMany({
    where: { paymentStatus: { in: ["PENDING", "PARTIAL"] } },
    include: {
      admission: {
        select: { admitId: true, patient: { select: { name: true } } },
      },
    },
    take: 20,
  });

  // Recent deposits
  const deposits = await prisma.deposit.findMany({
    where: { paymentDate: dateFilter },
    include: {
      admission: {
        select: { admitId: true, patient: { select: { name: true } } },
      },
    },
    orderBy: { paymentDate: "desc" },
    take: 20,
  });

  return {
    incomeStatement: {
      revenue: {
        opd: parseFloat(opdRev._sum.fee || 0),
        ipd: parseFloat(ipdRev._sum.grossTotal || 0),
        services: parseFloat(serviceRev._sum.totalFee || 0),
        other: 0,
        total: totalRevenue,
      },
      expenses: {
        ...expenseBreakdown,
        total: totalExpenses,
      },
      netProfit,
      profitMargin: totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : 0,
    },
    outstanding: outstanding.map((b) => ({
      billId: b.id,
      patient: b.admission.patient.name,
      admitId: b.admission.admitId,
      amount: parseFloat(b.balanceDue),
      dueDate: b.generatedDate,
    })),
    deposits: deposits.map((d) => ({
      receiptNo: d.receiptNumber,
      patient: d.admission.patient.name,
      amount: parseFloat(d.amount),
      date: d.paymentDate,
      mode: d.paymentMode,
    })),
  };
}

// ─── Operational Report ────────────────────────────────────
async function getOperationalReport(startDate, endDate) {
  const dateFilter = { gte: startDate, lte: endDate };

  // Room occupancy by type
  const rooms = await prisma.room.findMany({
    include: {
      roomType: true,
      beds: true,
    },
  });

  const roomTypeMap = {};
  rooms.forEach((room) => {
    const typeName = room.roomType.type;
    if (!roomTypeMap[typeName]) {
      roomTypeMap[typeName] = { total: 0, occupied: 0, available: 0 };
    }
    room.beds.forEach((bed) => {
      roomTypeMap[typeName].total++;
      if (bed.status === "OCCUPIED") roomTypeMap[typeName].occupied++;
      else if (bed.status === "AVAILABLE") roomTypeMap[typeName].available++;
    });
  });

  const roomOccupancy = Object.entries(roomTypeMap).map(([type, stats]) => ({
    type,
    total: stats.total,
    occupied: stats.occupied,
    available: stats.available,
    occupancyRate: stats.total > 0 ? ((stats.occupied / stats.total) * 100).toFixed(1) : 0,
  }));

  // Doctor performance
  const doctorPerformance = await prisma.doctor.findMany({
    select: {
      id: true,
      name: true,
      specialization: true,
      _count: {
        select: {
          opdVisits: { where: { visitDate: dateFilter } },
          admissions: { where: { admissionDate: dateFilter } },
        },
      },
    },
  });

  // Service usage
  const serviceUsage = await prisma.patientService.groupBy({
    by: ["serviceId"],
    where: { serviceDate: dateFilter },
    _sum: { totalFee: true },
    _count: true,
  });

  const services = await prisma.service.findMany({ select: { id: true, name: true } });
  const svcMap = Object.fromEntries(services.map((s) => [s.id, s.name]));

  return {
    roomOccupancy,
    doctorPerformance: doctorPerformance.map((d) => ({
      name: d.name,
      specialization: d.specialization,
      opdPatients: d._count.opdVisits,
      ipdPatients: d._count.admissions,
    })),
    serviceUsage: serviceUsage.map((su) => ({
      service: svcMap[su.serviceId] || "Unknown",
      count: su._count,
      revenue: parseFloat(su._sum.totalFee || 0),
    })),
  };
}

module.exports = { getReport };
