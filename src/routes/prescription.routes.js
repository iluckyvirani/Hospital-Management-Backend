const express = require("express");
const router = express.Router();
const {
  createPrescription,
  getPrescriptionById,
  getPatientPrescriptions,
  updatePrescription,
  deletePrescription,
} = require("../controllers/prescription.controller");
const { verifyJWT } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");

router.use(verifyJWT);

router.get("/patient/:patientId", getPatientPrescriptions);
router.get("/:id", getPrescriptionById);
router.post("/", allowRoles("SUPER_ADMIN", "DOCTOR"), createPrescription);
router.put("/:id", allowRoles("SUPER_ADMIN", "DOCTOR"), updatePrescription);
router.delete("/:id", allowRoles("SUPER_ADMIN", "DOCTOR"), deletePrescription);

module.exports = router;
