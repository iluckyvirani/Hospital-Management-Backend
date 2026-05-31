const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");
const { cloudinary } = require("../config/cloudinary");

// ─── Create Doctor ─────────────────────────────────────────
const createDoctor = asyncHandler(async (req, res) => {
    const {
        name, specialization, qualification,
        phone, email, consultationFee,
        opdLimitPerDay, timingFrom, timingTo,
        availableDays, status
    } = req.body;

    if (!name || !specialization || !qualification || !phone || !email || !consultationFee || !timingFrom || !timingTo) {
        throw new ApiError(400, "All required fields must be provided");
    }

    // Check email duplicate
    const existing = await prisma.doctor.findFirst({ where: { email } });
    if (existing) throw new ApiError(409, "Doctor with this email already exists");

    // Upload photo to Cloudinary if provided
    let photoUrl = null;
    if (req.file) {
        photoUrl = req.file.path;
    }

    // Handle availableDays — works for both JSON string and array
    let parsedDays = [];
    if (availableDays) {
        try {
            parsedDays = typeof availableDays === "string"
                ? JSON.parse(availableDays)
                : availableDays;
        } catch (e) {
            throw new ApiError(400, 'availableDays must be valid JSON array e.g. ["MONDAY","TUESDAY"]');
        }
    }

    const doctor = await prisma.doctor.create({
        data: {
            name,
            specialization,
            qualification,
            phone,
            email,
            photo: photoUrl,
            consultationFee: parseFloat(consultationFee),
            opdLimitPerDay: opdLimitPerDay ? parseInt(opdLimitPerDay) : 50,
            timingFrom,
            timingTo,
            status: status || "ACTIVE",
            availableDays: {
                create: parsedDays.map((day) => ({ day })),
            },
        },
        include: { availableDays: true },
    });

    return res.status(201).json(
        new ApiResponse(201, doctor, "Doctor created successfully")
    );
});

// ─── Get All Doctors ───────────────────────────────────────
const getAllDoctors = asyncHandler(async (req, res) => {
    const { status, specialization, search } = req.query;

    const where = {};
    if (status) where.status = status;
    if (specialization) where.specialization = { contains: specialization, mode: "insensitive" };
    if (search) {
        where.OR = [
            { name: { contains: search, mode: "insensitive" } },
            { specialization: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
        ];
    }

    const doctors = await prisma.doctor.findMany({
        where,
        include: { availableDays: true },
        orderBy: { createdAt: "desc" },
    });

    return res.status(200).json(
        new ApiResponse(200, doctors, "Doctors fetched successfully")
    );
});

// ─── Get Single Doctor ─────────────────────────────────────
const getDoctorById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const doctor = await prisma.doctor.findUnique({
        where: { id },
        include: { availableDays: true },
    });

    if (!doctor) throw new ApiError(404, "Doctor not found");

    return res.status(200).json(
        new ApiResponse(200, doctor, "Doctor fetched successfully")
    );
});

// ─── Update Doctor ─────────────────────────────────────────
const updateDoctor = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
        name, specialization, qualification,
        phone, email, consultationFee,
        opdLimitPerDay, timingFrom, timingTo,
        availableDays, status
    } = req.body;

    const doctor = await prisma.doctor.findUnique({ where: { id } });
    if (!doctor) throw new ApiError(404, "Doctor not found");

    // Handle new photo upload
    let photoUrl = doctor.photo;
    if (req.file) {
        if (doctor.photo) {
            const publicId = doctor.photo.split("/").pop().split(".")[0];
            await cloudinary.uploader.destroy(`dimag-hospital/${publicId}`);
        }
        photoUrl = req.file.path;
    }

    // Handle availableDays — works for both JSON string and array
    let parsedDays = null;
    if (availableDays) {
        try {
            parsedDays = typeof availableDays === "string"
                ? JSON.parse(availableDays)
                : availableDays;
        } catch (e) {
            throw new ApiError(400, 'availableDays must be valid JSON array e.g. ["MONDAY","TUESDAY"]');
        }
    }

    // Delete old days if new ones provided
    if (parsedDays) {
        await prisma.doctorDay.deleteMany({ where: { doctorId: id } });
    }

    const updated = await prisma.doctor.update({
        where: { id },
        data: {
            ...(name && { name }),
            ...(specialization && { specialization }),
            ...(qualification && { qualification }),
            ...(phone && { phone }),
            ...(email && { email }),
            photo: photoUrl,
            ...(consultationFee && { consultationFee: parseFloat(consultationFee) }),
            ...(opdLimitPerDay && { opdLimitPerDay: parseInt(opdLimitPerDay) }),
            ...(timingFrom && { timingFrom }),
            ...(timingTo && { timingTo }),
            ...(status && { status }),
            ...(parsedDays && {
                availableDays: {
                    create: parsedDays.map((day) => ({ day })),
                },
            }),
        },
        include: { availableDays: true },
    });

    return res.status(200).json(
        new ApiResponse(200, updated, "Doctor updated successfully")
    );
});

// ─── Toggle Doctor Status ──────────────────────────────────
const toggleDoctorStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const doctor = await prisma.doctor.findUnique({ where: { id } });
    if (!doctor) throw new ApiError(404, "Doctor not found");

    const updated = await prisma.doctor.update({
        where: { id },
        data: {
            status: doctor.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
        },
    });

    return res.status(200).json(
        new ApiResponse(200, updated, `Doctor ${updated.status === "ACTIVE" ? "activated" : "deactivated"} successfully`)
    );
});

// ─── Delete Doctor ─────────────────────────────────────────
const deleteDoctor = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const doctor = await prisma.doctor.findUnique({ where: { id } });
    if (!doctor) throw new ApiError(404, "Doctor not found");

    // Delete photo from Cloudinary
    if (doctor.photo) {
        const publicId = doctor.photo.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(`dimag-hospital/${publicId}`);
    }

    await prisma.doctor.delete({ where: { id } });

    return res.status(200).json(
        new ApiResponse(200, {}, "Doctor deleted successfully")
    );
});

// ─── Get Doctor Schedule ───────────────────────────────────
const getDoctorSchedule = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { date } = req.query; // e.g. 2026-03-15

    const doctor = await prisma.doctor.findUnique({
        where: { id },
        include: { availableDays: true },
    });
    if (!doctor) throw new ApiError(404, "Doctor not found");

    let opdCount = 0;
    if (date) {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);

        opdCount = await prisma.opdVisit.count({
            where: {
                doctorId: id,
                visitDate: { gte: start, lte: end },
            },
        });
    }

    return res.status(200).json(
        new ApiResponse(200, {
            doctor: {
                id: doctor.id,
                name: doctor.name,
                specialization: doctor.specialization,
                timingFrom: doctor.timingFrom,
                timingTo: doctor.timingTo,
                opdLimitPerDay: doctor.opdLimitPerDay,
                consultationFee: doctor.consultationFee,
                status: doctor.status,
            },
            availableDays: doctor.availableDays.map((d) => d.day),
            ...(date && {
                date,
                opdCount,
                remainingSlots: doctor.opdLimitPerDay - opdCount,
                isFull: opdCount >= doctor.opdLimitPerDay,
            }),
        }, "Doctor schedule fetched successfully")
    );
});

module.exports = {
    createDoctor,
    getAllDoctors,
    getDoctorById,
    updateDoctor,
    toggleDoctorStatus,
    deleteDoctor,
    getDoctorSchedule,
};