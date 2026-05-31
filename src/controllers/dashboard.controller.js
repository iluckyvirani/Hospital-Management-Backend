const prisma = require("../config/prisma");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");

// ─── Get Dashboard Stats ───────────────────────────────────
const getDashboardStats = asyncHandler(async (req, res) => {
  const period = req.query.period || "today"; // today | week | month

  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Calculate period start based on filter
  let periodStart = new Date(today);
  let previousStart = new Date(today);
  if (period === "week") {
    periodStart.setDate(periodStart.getDate() - 7);
    previousStart.setDate(previousStart.getDate() - 14);
  } else if (period === "month") {
    periodStart.setMonth(periodStart.getMonth() - 1);
    previousStart.setMonth(previousStart.getMonth() - 2);
  } else {
    // today
    previousStart.setDate(previousStart.getDate() - 1);
  }

  const periodEnd = tomorrow; // always up to end of today
  const previousEnd = new Date(periodStart);

  const [
    periodOPD,
    previousOPD,
    admittedPatients,
    totalBeds,
    occupiedBeds,
    periodRevenue,
    totalServices,
    periodExpenses,
  ] = await Promise.all([
    prisma.opdVisit.count({ where: { visitDate: { gte: periodStart, lt: periodEnd } } }),
    prisma.opdVisit.count({ where: { visitDate: { gte: previousStart, lt: previousEnd } } }),
    prisma.admission.count({ where: { status: { not: "DISCHARGED" } } }),
    prisma.bed.count(),
    prisma.bed.count({ where: { status: "OCCUPIED" } }),
    prisma.opdVisit.aggregate({
      where: { visitDate: { gte: periodStart, lt: periodEnd }, paymentStatus: "PAID" },
      _sum: { fee: true },
    }),
    prisma.service.count({ where: { status: "ACTIVE" } }),
    prisma.expense.aggregate({
      where: { expenseDate: { gte: periodStart, lt: periodEnd } },
      _sum: { amount: true },
    }),
  ]);

  const availableBeds = totalBeds - occupiedBeds;
  const opdChange = previousOPD > 0
    ? (((periodOPD - previousOPD) / previousOPD) * 100).toFixed(1)
    : 0;

  // Room occupancy breakdown
  const rooms = await prisma.room.findMany({
    include: { roomType: true, beds: true },
  });

  const roomData = {};
  rooms.forEach((room) => {
    const type = room.roomType.type;
    if (!roomData[type]) roomData[type] = { type, total: 0, occupied: 0, available: 0, cleaning: 0 };
    room.beds.forEach((bed) => {
      roomData[type].total++;
      if (bed.status === "OCCUPIED") roomData[type].occupied++;
      else if (bed.status === "AVAILABLE") roomData[type].available++;
      else if (bed.status === "CLEANING") roomData[type].cleaning++;
    });
  });

  // Revenue chart data
  const chartDays = period === "month" ? 30 : period === "week" ? 7 : 7;
  const revenueData = [];
  for (let i = chartDays - 1; i >= 0; i--) {
    const dayStart = new Date(today);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const [opdRev, ipdDeposits] = await Promise.all([
      prisma.opdVisit.aggregate({
        where: { visitDate: { gte: dayStart, lt: dayEnd }, paymentStatus: "PAID" },
        _sum: { fee: true },
      }),
      prisma.deposit.aggregate({
        where: { paymentDate: { gte: dayStart, lt: dayEnd } },
        _sum: { amount: true },
      }),
    ]);

    revenueData.push({
      day: dayStart.toLocaleDateString("en-US", { weekday: "short" }),
      opd: parseFloat(opdRev._sum.fee || 0),
      ipd: parseFloat(ipdDeposits._sum.amount || 0),
    });
  }

  // Discharge patients (ready today)
  const dischargePatients = await prisma.admission.findMany({
    where: { status: "READY_FOR_DISCHARGE" },
    include: {
      patient: { select: { name: true } },
      room: true,
    },
    take: 10,
  });

  return res.status(200).json(
    new ApiResponse(200, {
      stats: {
        todayOPD: { count: periodOPD, change: opdChange },
        admittedPatients,
        availableBeds: `${availableBeds}/${totalBeds}`,
        todayRevenue: parseFloat(periodRevenue._sum.fee || 0),
        totalServices,
        totalExpense: parseFloat(periodExpenses._sum.amount || 0),
      },
      roomData: Object.values(roomData),
      revenueData,
      dischargePatients: dischargePatients.map((a) => ({
        name: a.patient.name,
        room: a.room.roomNumber,
        status: "ready",
        admitId: a.admitId,
      })),
    }, "Dashboard stats fetched successfully")
  );
});

// ─── Get Recent Activities ─────────────────────────────────
const getRecentActivities = asyncHandler(async (req, res) => {
  const [recentOPD, recentAdmissions, recentDischarges, recentDeposits] = await Promise.all([
    prisma.opdVisit.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { patient: { select: { name: true } }, doctor: { select: { name: true } } },
    }),
    prisma.admission.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      where: { status: { not: "DISCHARGED" } },
      include: { patient: { select: { name: true } } },
    }),
    prisma.admission.findMany({
      take: 5,
      orderBy: { actualDischarge: "desc" },
      where: { status: "DISCHARGED" },
      include: { patient: { select: { name: true } } },
    }),
    prisma.deposit.findMany({
      take: 5,
      orderBy: { paymentDate: "desc" },
      include: { admission: { select: { patient: { select: { name: true } } } } },
    }),
  ]);

  const activities = [
    ...recentOPD.map((v) => ({
      title: "New OPD Visit",
      description: `${v.patient.name} visited Dr. ${v.doctor.name}`,
      time: v.createdAt,
      type: "opd",
    })),
    ...recentAdmissions.map((a) => ({
      title: "Patient Admitted",
      description: `${a.patient.name} admitted (${a.admitId})`,
      time: a.createdAt,
      type: "ipd",
    })),
    ...recentDischarges.map((a) => ({
      title: "Patient Discharged",
      description: `${a.patient.name} discharged`,
      time: a.actualDischarge,
      type: "discharge",
    })),
    ...recentDeposits.map((d) => ({
      title: "Payment Received",
      description: `₹${d.amount} deposit from ${d.admission.patient.name}`,
      time: d.paymentDate,
      type: "payment",
    })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 10);

  return res.status(200).json(
    new ApiResponse(200, activities, "Recent activities fetched successfully")
  );
});

// ─── Get Upcoming Appointments ─────────────────────────────
const getUpcomingAppointments = asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const appointments = await prisma.opdVisit.findMany({
    where: {
      visitDate: { gte: today, lt: tomorrow },
      paymentStatus: { not: "PAID" },
    },
    include: {
      patient: { select: { name: true } },
      doctor: { select: { name: true, specialization: true } },
    },
    orderBy: { tokenNumber: "asc" },
    take: 10,
  });

  return res.status(200).json(
    new ApiResponse(200, appointments.map((a) => ({
      patient: a.patient.name,
      doctor: a.doctor.name,
      time: a.visitDate,
      type: "Consultation",
      token: a.tokenNumber,
    })), "Upcoming appointments fetched successfully")
  );
});

module.exports = {
  getDashboardStats,
  getRecentActivities,
  getUpcomingAppointments,
};
