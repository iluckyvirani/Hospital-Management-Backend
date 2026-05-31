const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");

// ─── Create Room Type ──────────────────────────────────────
const createRoomType = asyncHandler(async (req, res) => {
  const { type, rentPerDay, facilities, description } = req.body;

  if (!type || !rentPerDay || !facilities) {
    throw new ApiError(400, "type, rentPerDay and facilities are required");
  }

  const existing = await prisma.roomTypeConfig.findUnique({ where: { type } });
  if (existing) throw new ApiError(409, "Room type already exists");

  const roomType = await prisma.roomTypeConfig.create({
    data: {
      type,
      rentPerDay: parseFloat(rentPerDay),
      facilities,
      description,
    },
  });

  return res.status(201).json(
    new ApiResponse(201, roomType, "Room type created successfully")
  );
});

// ─── Get All Room Types ────────────────────────────────────
const getAllRoomTypes = asyncHandler(async (req, res) => {
  const roomTypes = await prisma.roomTypeConfig.findMany({
    orderBy: { rentPerDay: "asc" },
  });

  return res.status(200).json(
    new ApiResponse(200, roomTypes, "Room types fetched successfully")
  );
});

// ─── Update Room Type ──────────────────────────────────────
const updateRoomType = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rentPerDay, facilities, description } = req.body;

  const roomType = await prisma.roomTypeConfig.findUnique({ where: { id } });
  if (!roomType) throw new ApiError(404, "Room type not found");

  const updated = await prisma.roomTypeConfig.update({
    where: { id },
    data: {
      ...(rentPerDay && { rentPerDay: parseFloat(rentPerDay) }),
      ...(facilities && { facilities }),
      ...(description && { description }),
    },
  });

  return res.status(200).json(
    new ApiResponse(200, updated, "Room type updated successfully")
  );
});

// ─── Delete Room Type ──────────────────────────────────────
const deleteRoomType = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const roomType = await prisma.roomTypeConfig.findUnique({ where: { id } });
  if (!roomType) throw new ApiError(404, "Room type not found");

  // Check if any room is using this type
  const roomsUsing = await prisma.room.count({ where: { roomTypeId: id } });
  if (roomsUsing > 0) {
    throw new ApiError(400, `Cannot delete — ${roomsUsing} room(s) are using this type`);
  }

  await prisma.roomTypeConfig.delete({ where: { id } });

  return res.status(200).json(
    new ApiResponse(200, {}, "Room type deleted successfully")
  );
});

// ─── Create Room ───────────────────────────────────────────
const createRoom = asyncHandler(async (req, res) => {
  const { roomNumber, roomTypeId, totalBeds } = req.body;

  if (!roomNumber || !roomTypeId || !totalBeds) {
    throw new ApiError(400, "roomNumber, roomTypeId and totalBeds are required");
  }

  // Check room number duplicate
  const existing = await prisma.room.findUnique({ where: { roomNumber } });
  if (existing) throw new ApiError(409, "Room number already exists");

  // Check room type exists
  const roomType = await prisma.roomTypeConfig.findUnique({ where: { id: roomTypeId } });
  if (!roomType) throw new ApiError(404, "Room type not found");

  // Create room + auto-create beds
  const bedsCount = parseInt(totalBeds);
  const room = await prisma.room.create({
    data: {
      roomNumber,
      roomTypeId,
      totalBeds: bedsCount,
      beds: {
        create: Array.from({ length: bedsCount }, (_, i) => ({
          bedNumber: `B${i + 1}`,
          status: "AVAILABLE",
        })),
      },
    },
    include: {
      beds: true,
      roomType: true,
    },
  });

  return res.status(201).json(
    new ApiResponse(201, room, "Room created successfully")
  );
});

// ─── Get All Rooms ─────────────────────────────────────────
const getAllRooms = asyncHandler(async (req, res) => {
  const { roomTypeId, status } = req.query;

  const where = {};
  if (roomTypeId) where.roomTypeId = roomTypeId;
  if (status) where.status = status;

  const rooms = await prisma.room.findMany({
    where,
    include: {
      roomType: true,
      beds: true,
    },
    orderBy: { roomNumber: "asc" },
  });

  // Add bed stats to each room
  const roomsWithStats = rooms.map((room) => ({
    ...room,
    bedStats: {
      total: room.beds.length,
      available: room.beds.filter((b) => b.status === "AVAILABLE").length,
      occupied: room.beds.filter((b) => b.status === "OCCUPIED").length,
      cleaning: room.beds.filter((b) => b.status === "CLEANING").length,
    },
  }));

  return res.status(200).json(
    new ApiResponse(200, roomsWithStats, "Rooms fetched successfully")
  );
});

// ─── Get Single Room ───────────────────────────────────────
const getRoomById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const room = await prisma.room.findUnique({
    where: { id },
    include: {
      roomType: true,
      beds: true,
    },
  });

  if (!room) throw new ApiError(404, "Room not found");

  const roomWithStats = {
    ...room,
    bedStats: {
      total: room.beds.length,
      available: room.beds.filter((b) => b.status === "AVAILABLE").length,
      occupied: room.beds.filter((b) => b.status === "OCCUPIED").length,
      cleaning: room.beds.filter((b) => b.status === "CLEANING").length,
    },
  };

  return res.status(200).json(
    new ApiResponse(200, roomWithStats, "Room fetched successfully")
  );
});

// ─── Update Room ───────────────────────────────────────────
const updateRoom = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { roomNumber, roomTypeId, status, totalBeds } = req.body;

  const room = await prisma.room.findUnique({
    where: { id },
    include: { beds: true },
  });
  if (!room) throw new ApiError(404, "Room not found");

  const updateData = {
    ...(roomNumber && { roomNumber }),
    ...(roomTypeId && { roomTypeId }),
    ...(status && { status }),
  };

  // Handle totalBeds change
  if (totalBeds !== undefined && totalBeds !== null) {
    const newTotal = parseInt(totalBeds);
    if (isNaN(newTotal) || newTotal < 1) {
      throw new ApiError(400, "totalBeds must be at least 1");
    }

    const currentTotal = room.beds.length;

    if (newTotal > currentTotal) {
      // Add new beds
      const bedsToAdd = newTotal - currentTotal;
      const maxBedNum = room.beds.reduce((max, b) => {
        const num = parseInt(b.bedNumber.replace(/\D/g, "")) || 0;
        return num > max ? num : max;
      }, 0);

      updateData.totalBeds = newTotal;
      updateData.beds = {
        create: Array.from({ length: bedsToAdd }, (_, i) => ({
          bedNumber: `B${maxBedNum + i + 1}`,
          status: "AVAILABLE",
        })),
      };
    } else if (newTotal < currentTotal) {
      // Remove beds — only non-occupied ones, starting from the end
      const occupiedCount = room.beds.filter((b) => b.status === "OCCUPIED").length;
      if (newTotal < occupiedCount) {
        throw new ApiError(
          400,
          `Cannot reduce to ${newTotal} beds — ${occupiedCount} bed(s) are currently occupied`
        );
      }

      const bedsToRemove = currentTotal - newTotal;
      // Prefer removing AVAILABLE beds first, then CLEANING, never OCCUPIED
      const removable = room.beds
        .filter((b) => b.status !== "OCCUPIED")
        .sort((a, b) => {
          if (a.status === "AVAILABLE" && b.status !== "AVAILABLE") return -1;
          if (a.status !== "AVAILABLE" && b.status === "AVAILABLE") return 1;
          const aNum = parseInt(a.bedNumber.replace(/\D/g, "")) || 0;
          const bNum = parseInt(b.bedNumber.replace(/\D/g, "")) || 0;
          return bNum - aNum; // higher bed numbers first
        })
        .slice(0, bedsToRemove);

      updateData.totalBeds = newTotal;
      updateData.beds = {
        deleteMany: { id: { in: removable.map((b) => b.id) } },
      };
    } else {
      updateData.totalBeds = newTotal;
    }
  }

  const updated = await prisma.room.update({
    where: { id },
    data: updateData,
    include: { roomType: true, beds: true },
  });

  return res.status(200).json(
    new ApiResponse(200, updated, "Room updated successfully")
  );
});

// ─── Delete Room ───────────────────────────────────────────
const deleteRoom = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const room = await prisma.room.findUnique({
    where: { id },
    include: { beds: true },
  });
  if (!room) throw new ApiError(404, "Room not found");

  // Check if any bed is occupied
  const occupiedBeds = room.beds.filter((b) => b.status === "OCCUPIED");
  if (occupiedBeds.length > 0) {
    throw new ApiError(400, `Cannot delete — ${occupiedBeds.length} bed(s) are occupied`);
  }

  await prisma.room.delete({ where: { id } });

  return res.status(200).json(
    new ApiResponse(200, {}, "Room deleted successfully")
  );
});

// ─── Get Available Rooms ───────────────────────────────────
const getAvailableRooms = asyncHandler(async (req, res) => {
  const { roomTypeId } = req.query;

  const where = {
    beds: { some: { status: "AVAILABLE" } },
  };
  if (roomTypeId) where.roomTypeId = roomTypeId;

  const rooms = await prisma.room.findMany({
    where,
    include: {
      roomType: true,
      beds: {
        where: { status: "AVAILABLE" },
      },
    },
    orderBy: { roomNumber: "asc" },
  });

  return res.status(200).json(
    new ApiResponse(200, rooms, "Available rooms fetched successfully")
  );
});

// ─── Update Bed Status ─────────────────────────────────────
const updateBedStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) throw new ApiError(400, "Status is required");

  const validStatuses = ["AVAILABLE", "OCCUPIED", "CLEANING"];
  if (!validStatuses.includes(status)) {
    throw new ApiError(400, `Status must be one of: ${validStatuses.join(", ")}`);
  }

  const bed = await prisma.bed.findUnique({ where: { id } });
  if (!bed) throw new ApiError(404, "Bed not found");

  // Cannot manually set occupied — only admission does that
  if (status === "OCCUPIED") {
    throw new ApiError(400, "Cannot manually set bed to OCCUPIED — this happens automatically on patient admission");
  }

  const updated = await prisma.bed.update({
    where: { id },
    data: { status },
  });

  return res.status(200).json(
    new ApiResponse(200, updated, `Bed status updated to ${status}`)
  );
});

// ─── Get All Beds of a Room ────────────────────────────────
const getRoomBeds = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.query;

  const room = await prisma.room.findUnique({ where: { id } });
  if (!room) throw new ApiError(404, "Room not found");

  const where = { roomId: id };
  if (status) where.status = status;

  const beds = await prisma.bed.findMany({
    where,
    orderBy: { bedNumber: "asc" },
  });

  return res.status(200).json(
    new ApiResponse(200, beds, "Beds fetched successfully")
  );
});

module.exports = {
  createRoomType,
  getAllRoomTypes,
  updateRoomType,
  deleteRoomType,
  createRoom,
  getAllRooms,
  getRoomById,
  updateRoom,
  deleteRoom,
  getAvailableRooms,
  updateBedStatus,
  getRoomBeds,
};