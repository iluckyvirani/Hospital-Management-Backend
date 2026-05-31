const express = require("express");
const router = express.Router();
const { getReport } = require("../controllers/report.controller");
const { exportIpdPdf, exportOpdPdf } = require("../controllers/pdf.controller");
const { verifyJWT } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");

router.use(verifyJWT);

// PDF export routes (must be before /:type to avoid conflict)
router.get("/ipd/pdf", exportIpdPdf);
router.get("/opd/pdf", exportOpdPdf);

router.get("/:type", allowRoles("SUPER_ADMIN"), getReport);

module.exports = router;
