const ApiError = require("../utils/ApiError");

const allowRoles = (...roles) => (req, res, next) => {
  if (!req.user) throw new ApiError(401, "Unauthorized");

  if (!roles.includes(req.user.role)) {
    throw new ApiError(403, `Access denied. Required roles: ${roles.join(", ")}`);
  }
  next();
};

module.exports = { allowRoles };