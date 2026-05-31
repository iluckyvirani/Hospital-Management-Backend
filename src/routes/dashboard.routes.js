const express = require("express");
const router = express.Router();
const {
  getDashboardStats,
  getRecentActivities,
  getUpcomingAppointments,
} = require("../controllers/dashboard.controller");
const { verifyJWT } = require("../middleware/auth.middleware");

router.use(verifyJWT);

router.get("/stats", getDashboardStats);
router.get("/recent-activities", getRecentActivities);
router.get("/upcoming-appointments", getUpcomingAppointments);

module.exports = router;
