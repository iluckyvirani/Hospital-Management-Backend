const express = require("express");
const router = express.Router();
const {
  admitPatient,
  getAllAdmissions,
  getAdmissionById,
  addDeposit,
  dischargePatient,
  getDischargeCard,
  getDepositSlip,
  saveMedicalForm,
  getMedicalForms,
  getMedicalForm,
  deleteMedicalForm,
  updateAdmission,
  deleteAdmission,
  updateDeposit,
  deleteDeposit,
} = require("../controllers/admission.controller");
const { verifyJWT } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");

router.use(verifyJWT);

router.post("/admit", allowRoles("SUPER_ADMIN", "RECEPTION"), admitPatient);
router.get("/patients", getAllAdmissions);
router.get("/patients/:id", getAdmissionById);
router.put("/patients/:id", allowRoles("SUPER_ADMIN"), updateAdmission);
router.delete("/patients/:id", allowRoles("SUPER_ADMIN"), deleteAdmission);
router.post("/patients/:id/deposit", allowRoles("SUPER_ADMIN", "RECEPTION"), addDeposit);
router.put("/deposits/:depositId", allowRoles("SUPER_ADMIN"), updateDeposit);
router.delete("/deposits/:depositId", allowRoles("SUPER_ADMIN"), deleteDeposit);
router.get("/deposits/:depositId/slip", getDepositSlip);
router.post("/discharge/:id", allowRoles("SUPER_ADMIN", "DOCTOR", "RECEPTION"), dischargePatient);
router.get("/discharge-card/:id", getDischargeCard);

// Medical Forms Routes
router.post("/patients/:id/medical-forms", allowRoles("SUPER_ADMIN", "DOCTOR", "RECEPTION"), saveMedicalForm);
router.get("/patients/:id/medical-forms", getMedicalForms);
router.delete("/patients/:id/medical-forms", allowRoles("SUPER_ADMIN"), deleteMedicalForm);

module.exports = router;
