const express = require("express");
const router = express.Router();
const {
  createCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  createService,
  getAllServices,
  getServiceById,
  updateService,
  deleteService,
  assignService,
  getAssignedServices,
  updateAssignedService,
  deleteAssignedService,
} = require("../controllers/service.controller");
const { verifyJWT } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");

router.use(verifyJWT);

// Categories
router.get("/categories", getAllCategories);
router.post("/categories", allowRoles("SUPER_ADMIN"), createCategory);
router.put("/categories/:id", allowRoles("SUPER_ADMIN"), updateCategory);
router.delete("/categories/:id", allowRoles("SUPER_ADMIN"), deleteCategory);

// Services CRUD
router.get("/", getAllServices);
router.get("/assigned", getAssignedServices);
router.get("/:id", getServiceById);
router.post("/", allowRoles("SUPER_ADMIN"), createService);
router.put("/:id", allowRoles("SUPER_ADMIN"), updateService);
router.delete("/:id", allowRoles("SUPER_ADMIN"), deleteService);

// Assign to patient
router.post("/assign", allowRoles("SUPER_ADMIN", "RECEPTION", "DOCTOR"), assignService);
router.put("/assign/:id", allowRoles("SUPER_ADMIN"), updateAssignedService);
router.delete("/assign/:id", allowRoles("SUPER_ADMIN"), deleteAssignedService);

module.exports = router;
