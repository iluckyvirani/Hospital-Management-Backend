const express = require("express");
const router = express.Router();
const {
  getHospitalSettings,
  updateHospitalSettings,
  getTeamMembers,
  addTeamMember,
  updateTeamMember,
  changeTeamMemberPassword,
  deleteTeamMember,
} = require("../controllers/settings.controller");
const { verifyJWT } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");
const { upload } = require("../config/cloudinary");

router.use(verifyJWT);

// Hospital Settings
router.get("/hospital", getHospitalSettings);
router.put("/hospital", allowRoles("SUPER_ADMIN"), upload.single("logo"), updateHospitalSettings);

// Team Management
router.get("/team", allowRoles("SUPER_ADMIN"), getTeamMembers);
router.post("/team", allowRoles("SUPER_ADMIN"), addTeamMember);
router.put("/team/:id", allowRoles("SUPER_ADMIN"), updateTeamMember);
router.put("/team/:id/password", allowRoles("SUPER_ADMIN"), changeTeamMemberPassword);
router.delete("/team/:id", allowRoles("SUPER_ADMIN"), deleteTeamMember);

module.exports = router;
