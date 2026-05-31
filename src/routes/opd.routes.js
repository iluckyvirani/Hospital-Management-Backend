const express = require("express");
const router = express.Router();
const {
  getNextToken,
  createOpdVisit,
  getAllOpdVisits,
  getTodayOpdVisits,
  getOpdVisitById,
  updateOpdVisit,
  updatePaymentStatus,
  getOpdSlip,
  deleteOpdVisit,
  markOpdChecked,
} = require("../controllers/opd.controller");
const { verifyJWT } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");

router.use(verifyJWT);

router.get("/token/next", getNextToken);
router.get("/today", getTodayOpdVisits);
router.get("/", getAllOpdVisits);
router.get("/:id", getOpdVisitById);
router.get("/:id/slip", getOpdSlip);
router.post("/", allowRoles("SUPER_ADMIN", "RECEPTION"), createOpdVisit);
router.put("/:id", allowRoles("SUPER_ADMIN"), updateOpdVisit);
router.put("/:id/payment", allowRoles("SUPER_ADMIN"), updatePaymentStatus);
router.patch("/:id/check", allowRoles("SUPER_ADMIN"), markOpdChecked);
router.delete("/:id", allowRoles("SUPER_ADMIN"), deleteOpdVisit);

module.exports = router;