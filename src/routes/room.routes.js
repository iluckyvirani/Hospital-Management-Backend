const express = require("express");
const router = express.Router();
const {
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
} = require("../controllers/room.controller");
const { verifyJWT } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");

router.use(verifyJWT);

// ─── Room Types ────────────────────────────────────────────
router.get("/types", getAllRoomTypes);
router.post("/types", allowRoles("SUPER_ADMIN"), createRoomType);
router.put("/types/:id", allowRoles("SUPER_ADMIN"), updateRoomType);
router.delete("/types/:id", allowRoles("SUPER_ADMIN"), deleteRoomType);

// ─── Rooms ─────────────────────────────────────────────────
router.get("/available", getAvailableRooms);
router.get("/", getAllRooms);
router.get("/:id", getRoomById);
router.get("/:id/beds", getRoomBeds);
router.post("/", allowRoles("SUPER_ADMIN"), createRoom);
router.put("/:id", allowRoles("SUPER_ADMIN"), updateRoom);
router.delete("/:id", allowRoles("SUPER_ADMIN"), deleteRoom);

// ─── Beds ──────────────────────────────────────────────────
router.patch("/beds/:id/status", allowRoles("SUPER_ADMIN", "RECEPTION"), updateBedStatus);

module.exports = router;