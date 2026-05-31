const express = require("express");
const router = express.Router();
const {
  login,
  logout,
  refreshToken,
  getMe,
  changePassword,
} = require("../controllers/auth.controller");
const { verifyJWT } = require("../middleware/auth.middleware");

// Public routes
router.post("/login", login);
router.post("/refresh-token", refreshToken);

// Protected routes
router.post("/logout", verifyJWT, logout);
router.get("/me", verifyJWT, getMe);
router.post("/change-password", verifyJWT, changePassword);

module.exports = router;