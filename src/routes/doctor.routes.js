const express = require("express");
const router = express.Router();
const {
  createDoctor,
  getAllDoctors,
  getDoctorById,
  updateDoctor,
  toggleDoctorStatus,
  deleteDoctor,
  getDoctorSchedule,
} = require("../controllers/doctor.controller");
const { verifyJWT } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");
const { upload } = require("../config/cloudinary");

// All routes require login
router.use(verifyJWT);

// GET routes — all roles can view doctors
router.get("/", getAllDoctors);
router.get("/:id", getDoctorById);
router.get("/:id/schedule", getDoctorSchedule);

// Write routes — Super Admin only
router.post("/", allowRoles("SUPER_ADMIN"), upload.single("photo"), createDoctor);
router.put("/:id", allowRoles("SUPER_ADMIN"), upload.single("photo"), updateDoctor);
router.patch("/:id/status", allowRoles("SUPER_ADMIN"), toggleDoctorStatus);
router.delete("/:id", allowRoles("SUPER_ADMIN"), deleteDoctor);

module.exports = router;