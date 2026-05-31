const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");
const { cloudinary } = require("../config/cloudinary");

// ─── Get Hospital Settings ─────────────────────────────────
const getHospitalSettings = asyncHandler(async (req, res) => {
  let settings = await prisma.hospitalSettings.findFirst();

  if (!settings) {
    // Create default settings if none exist
    settings = await prisma.hospitalSettings.create({
      data: {
        name: "Dr. Help",
        address: "",
        phone: "",
      },
    });
  }

  return res.status(200).json(
    new ApiResponse(200, settings, "Hospital settings fetched successfully")
  );
});

// ─── Update Hospital Settings ──────────────────────────────
const updateHospitalSettings = asyncHandler(async (req, res) => {
  const {
    name, tagline, address, city, state, pincode,
    phone, mobile, email, website,
    gstNumber, registrationNo,
    printHeader, printFooter,
  } = req.body;

  let settings = await prisma.hospitalSettings.findFirst();

  // Handle logo upload
  let logoUrl = settings?.logo;
  if (req.file) {
    if (settings?.logo) {
      const publicId = settings.logo.split("/").pop().split(".")[0];
      await cloudinary.uploader.destroy(`dimag-hospital/${publicId}`);
    }
    logoUrl = req.file.path;
  }

  if (!settings) {
    settings = await prisma.hospitalSettings.create({
      data: {
        name: name || "Dr. Help",
        tagline,
        address: address || "",
        city,
        state,
        pincode,
        phone: phone || "",
        mobile,
        email,
        website,
        logo: logoUrl,
        gstNumber,
        registrationNo,
        printHeader,
        printFooter,
      },
    });
  } else {
    settings = await prisma.hospitalSettings.update({
      where: { id: settings.id },
      data: {
        ...(name !== undefined && { name }),
        ...(tagline !== undefined && { tagline }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(pincode !== undefined && { pincode }),
        ...(phone !== undefined && { phone }),
        ...(mobile !== undefined && { mobile }),
        ...(email !== undefined && { email }),
        ...(website !== undefined && { website }),
        logo: logoUrl,
        ...(gstNumber !== undefined && { gstNumber }),
        ...(registrationNo !== undefined && { registrationNo }),
        ...(printHeader !== undefined && { printHeader }),
        ...(printFooter !== undefined && { printFooter }),
      },
    });
  }

  return res.status(200).json(
    new ApiResponse(200, settings, "Hospital settings updated successfully")
  );
});

// ─── Get All Team Members ──────────────────────────────────
const getTeamMembers = asyncHandler(async (req, res) => {
  const { search, role, status } = req.query;

  const where = {};
  if (role) where.role = role;
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      lastLogin: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return res.status(200).json(
    new ApiResponse(200, users, "Team members fetched successfully")
  );
});

// ─── Add Team Member ───────────────────────────────────────
const addTeamMember = asyncHandler(async (req, res) => {
  const { name, role, email, phone, username, password, status } = req.body;

  if (!name || !role || !email || !phone || !username || !password) {
    throw new ApiError(400, "name, role, email, phone, username and password are required");
  }

  // Validate role — no pharmacy
  const validRoles = ["SUPER_ADMIN", "DOCTOR", "RECEPTION"];
  if (!validRoles.includes(role)) {
    throw new ApiError(400, `Role must be one of: ${validRoles.join(", ")}`);
  }

  // Check duplicates
  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) throw new ApiError(409, "Email already exists");

  const existingUsername = await prisma.user.findUnique({ where: { username } });
  if (existingUsername) throw new ApiError(409, "Username already exists");

  const bcrypt = require("bcryptjs");
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name,
      role,
      email,
      phone,
      username,
      password: hashedPassword,
      status: status || "ACTIVE",
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  return res.status(201).json(
    new ApiResponse(201, user, "Team member added successfully")
  );
});

// ─── Update Team Member ────────────────────────────────────
const updateTeamMember = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, role, email, phone, status } = req.body;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "User not found");

  // Validate role if provided
  if (role) {
    const validRoles = ["SUPER_ADMIN", "DOCTOR", "RECEPTION"];
    if (!validRoles.includes(role)) {
      throw new ApiError(400, `Role must be one of: ${validRoles.join(", ")}`);
    }
  }

  const updateData = {
    ...(name && { name }),
    ...(role && { role }),
    ...(email && { email }),
    ...(phone && { phone }),
    ...(status && { status }),
  };

  const updated = await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      lastLogin: true,
    },
  });

  return res.status(200).json(
    new ApiResponse(200, updated, "Team member updated successfully")
  );
});

// ─── Change Team Member Password ───────────────────────────
const changeTeamMemberPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    throw new ApiError(400, "Password is required and must be at least 6 characters");
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "User not found");

  const bcrypt = require("bcryptjs");
  const hashedPassword = await bcrypt.hash(password, 10);

  await prisma.user.update({
    where: { id },
    data: { password: hashedPassword },
  });

  return res.status(200).json(
    new ApiResponse(200, {}, "Password updated successfully")
  );
});

// ─── Delete Team Member ────────────────────────────────────
const deleteTeamMember = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "User not found");

  // Prevent deleting yourself
  if (user.id === req.user.id) {
    throw new ApiError(400, "Cannot delete your own account");
  }

  await prisma.user.delete({ where: { id } });

  return res.status(200).json(
    new ApiResponse(200, {}, "Team member deleted successfully")
  );
});

module.exports = {
  getHospitalSettings,
  updateHospitalSettings,
  getTeamMembers,
  addTeamMember,
  updateTeamMember,
  changeTeamMemberPassword,
  deleteTeamMember,
};
