const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");

// ─── Create Service Category ───────────────────────────────
const createCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  if (!name) throw new ApiError(400, "Category name is required");

  const existing = await prisma.serviceCategory.findUnique({ where: { name } });
  if (existing) throw new ApiError(409, "Category already exists");

  const category = await prisma.serviceCategory.create({
    data: { name, description },
  });

  return res.status(201).json(
    new ApiResponse(201, category, "Category created successfully")
  );
});

// ─── Get All Categories ────────────────────────────────────
const getAllCategories = asyncHandler(async (req, res) => {
  const categories = await prisma.serviceCategory.findMany({
    include: { _count: { select: { services: true } } },
    orderBy: { name: "asc" },
  });

  return res.status(200).json(
    new ApiResponse(200, categories, "Categories fetched successfully")
  );
});

// ─── Update Service Category ───────────────────────────────
const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  const category = await prisma.serviceCategory.findUnique({ where: { id } });
  if (!category) throw new ApiError(404, "Category not found");

  if (name && name !== category.name) {
    const existing = await prisma.serviceCategory.findUnique({ where: { name } });
    if (existing) throw new ApiError(409, "Category name already exists");
  }

  const updated = await prisma.serviceCategory.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
    },
  });

  return res.status(200).json(
    new ApiResponse(200, updated, "Category updated successfully")
  );
});

// ─── Delete Service Category ───────────────────────────────
const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const category = await prisma.serviceCategory.findUnique({
    where: { id },
    include: { _count: { select: { services: true } } },
  });
  if (!category) throw new ApiError(404, "Category not found");
  if (category._count.services > 0) {
    throw new ApiError(400, "Cannot delete category with existing services. Remove services first.");
  }

  await prisma.serviceCategory.delete({ where: { id } });

  return res.status(200).json(
    new ApiResponse(200, {}, "Category deleted successfully")
  );
});

// ─── Create Service ────────────────────────────────────────
const createService = asyncHandler(async (req, res) => {
  const { name, categoryId, description, fee, status } = req.body;

  if (!name || !categoryId || !fee) {
    throw new ApiError(400, "name, categoryId and fee are required");
  }

  const category = await prisma.serviceCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new ApiError(404, "Category not found");

  const service = await prisma.service.create({
    data: {
      name,
      categoryId,
      description,
      fee: parseFloat(fee),
      status: status || "ACTIVE",
    },
    include: { category: true },
  });

  return res.status(201).json(
    new ApiResponse(201, service, "Service created successfully")
  );
});

// ─── Get All Services ──────────────────────────────────────
const getAllServices = asyncHandler(async (req, res) => {
  const { search, categoryId, status } = req.query;

  const where = {};
  if (categoryId) where.categoryId = categoryId;
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const services = await prisma.service.findMany({
    where,
    include: { category: true },
    orderBy: { createdAt: "desc" },
  });

  return res.status(200).json(
    new ApiResponse(200, services, "Services fetched successfully")
  );
});

// ─── Get Single Service ────────────────────────────────────
const getServiceById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const service = await prisma.service.findUnique({
    where: { id },
    include: { category: true },
  });

  if (!service) throw new ApiError(404, "Service not found");

  return res.status(200).json(
    new ApiResponse(200, service, "Service fetched successfully")
  );
});

// ─── Update Service ────────────────────────────────────────
const updateService = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, categoryId, description, fee, status } = req.body;

  const service = await prisma.service.findUnique({ where: { id } });
  if (!service) throw new ApiError(404, "Service not found");

  const updated = await prisma.service.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(categoryId && { categoryId }),
      ...(description !== undefined && { description }),
      ...(fee && { fee: parseFloat(fee) }),
      ...(status && { status }),
    },
    include: { category: true },
  });

  return res.status(200).json(
    new ApiResponse(200, updated, "Service updated successfully")
  );
});

// ─── Delete Service ────────────────────────────────────────
const deleteService = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const service = await prisma.service.findUnique({ where: { id } });
  if (!service) throw new ApiError(404, "Service not found");

  await prisma.service.delete({ where: { id } });

  return res.status(200).json(
    new ApiResponse(200, {}, "Service deleted successfully")
  );
});

// ─── Assign Service to Patient ─────────────────────────────
const assignService = asyncHandler(async (req, res) => {
  const { admissionId, services, serviceDate, notes } = req.body;

  if (!admissionId || !services || !services.length) {
    throw new ApiError(400, "admissionId and services array are required");
  }

  const admission = await prisma.admission.findUnique({ where: { id: admissionId } });
  if (!admission) throw new ApiError(404, "Admission not found");
  if (admission.status === "DISCHARGED") throw new ApiError(400, "Cannot assign service to discharged patient");

  const assignedServices = await prisma.$transaction(
    services.map((svc) =>
      prisma.patientService.create({
        data: {
          admissionId,
          serviceId: svc.id,
          quantity: svc.quantity || 1,
          totalFee: parseFloat(svc.fee) * (svc.quantity || 1),
          serviceDate: serviceDate ? new Date(serviceDate) : new Date(),
          assignedBy: req.user.id,
          notes,
        },
        include: { service: true },
      })
    )
  );

  return res.status(201).json(
    new ApiResponse(201, assignedServices, "Services assigned successfully")
  );
});

// ─── Update Assigned Service ───────────────────────────────
const updateAssignedService = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { serviceId, quantity, serviceDate, notes } = req.body;

  const existing = await prisma.patientService.findUnique({ where: { id }, include: { service: true } });
  if (!existing) throw new ApiError(404, "Assigned service not found");

  // If serviceId changed, look up the new service for fee calculation
  let fee = existing.service.fee;
  if (serviceId && serviceId !== existing.serviceId) {
    const newService = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!newService) throw new ApiError(404, "Service not found");
    fee = newService.fee;
  }

  const qty = quantity !== undefined ? Number(quantity) : existing.quantity;

  const updated = await prisma.patientService.update({
    where: { id },
    data: {
      ...(serviceId && { serviceId }),
      ...(quantity !== undefined && { quantity: qty }),
      totalFee: parseFloat(fee) * qty,
      ...(serviceDate && { serviceDate: new Date(serviceDate) }),
      ...(notes !== undefined && { notes }),
    },
    include: { service: true, admission: { select: { admitId: true } }, user: { select: { name: true } } },
  });

  return res.status(200).json(
    new ApiResponse(200, updated, "Assigned service updated successfully")
  );
});

// ─── Delete Assigned Service ───────────────────────────────
const deleteAssignedService = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await prisma.patientService.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Assigned service not found");

  await prisma.patientService.delete({ where: { id } });

  return res.status(200).json(
    new ApiResponse(200, {}, "Assigned service deleted successfully")
  );
});

// ─── Get Patient's Assigned Services ───────────────────────
const getAssignedServices = asyncHandler(async (req, res) => {
  const { admissionId } = req.query;

  const where = {};
  if (admissionId) where.admissionId = admissionId;

  const services = await prisma.patientService.findMany({
    where,
    include: {
      service: true,
      admission: {
        select: { admitId: true, patient: { select: { name: true } } },
      },
      user: { select: { name: true } },
    },
    orderBy: { serviceDate: "desc" },
  });

  return res.status(200).json(
    new ApiResponse(200, services, "Assigned services fetched successfully")
  );
});

module.exports = {
  createCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  createService,
  getAllServices,
  getServiceById,
  updateService,
  deleteService,
  assignService,
  getAssignedServices,
  updateAssignedService,
  deleteAssignedService,
};
