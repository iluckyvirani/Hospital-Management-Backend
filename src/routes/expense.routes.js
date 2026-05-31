const express = require("express");
const router = express.Router();
const {
  getAllExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  getExpenseCategories,
  createExpenseCategory,
  getExpenseStats,
} = require("../controllers/expense.controller");
const { verifyJWT } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");
const { upload } = require("../config/cloudinary");

router.use(verifyJWT);

router.get("/categories", getExpenseCategories);
router.post("/categories", allowRoles("SUPER_ADMIN"), createExpenseCategory);
router.get("/stats", getExpenseStats);
router.get("/", getAllExpenses);
router.post("/", allowRoles("SUPER_ADMIN"), upload.single("receiptFile"), createExpense);
router.put("/:id", allowRoles("SUPER_ADMIN"), upload.single("receiptFile"), updateExpense);
router.delete("/:id", allowRoles("SUPER_ADMIN"), deleteExpense);

module.exports = router;
