const express = require("express");
const router = express.Router();
const {
  createPatient,
  getAllPatients,
  getPatientById,
  updatePatient,
  deletePatient,
  getPatientOpdHistory,
  getPatientAdmitHistory,
  getPatientMedicineHistory,
  getPatientServiceHistory,
  getPatientPaymentHistory,
  uploadMedicalReport,
  getMedicalReports,
  deleteMedicalReport,
} = require("../controllers/patient.controller");
const { verifyJWT } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");
const { upload } = require("../config/cloudinary");

router.use(verifyJWT);

// ─── Patient CRUD ──────────────────────────────────────────
router.post("/", createPatient);
router.get("/", getAllPatients);
router.get("/:id", getPatientById);
router.put("/:id", updatePatient);
router.delete("/:id", deletePatient);

// ─── Patient History Tabs ──────────────────────────────────
router.get("/:id/opd-history", getPatientOpdHistory);
router.get("/:id/admit-history", getPatientAdmitHistory);
router.get("/:id/medicine-history", getPatientMedicineHistory);
router.get("/:id/service-history", getPatientServiceHistory);
router.get("/:id/payment-history", getPatientPaymentHistory);

// ─── Medical Reports ───────────────────────────────────────
router.post("/:id/reports", upload.single("file"), uploadMedicalReport);
router.get("/:id/reports", getMedicalReports);
router.delete("/:id/reports/:reportId", deleteMedicalReport);

module.exports = router;