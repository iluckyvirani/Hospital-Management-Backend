const express = require("express");
const router = express.Router();
const {
  getBillingDashboard,
  getAllBills,
  getAllDeposits,
  generateBill,
  updateBillPayment,
  updateBill,
  deleteBill,
  exportDepositsPdf,
  exportRefundsPdf,
} = require("../controllers/billing.controller");
const { verifyJWT } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");

router.use(verifyJWT);

router.get("/dashboard", getBillingDashboard);
router.get("/deposits/pdf", exportDepositsPdf);
router.get("/refunds/pdf", exportRefundsPdf);
router.get("/deposits", getAllDeposits);
router.get("/", getAllBills);
router.post("/generate", allowRoles("SUPER_ADMIN", "RECEPTION"), generateBill);
router.patch("/:id/payment", allowRoles("SUPER_ADMIN", "RECEPTION"), updateBillPayment);
router.put("/:id", allowRoles("SUPER_ADMIN"), updateBill);
router.delete("/:id", allowRoles("SUPER_ADMIN"), deleteBill);

module.exports = router;
