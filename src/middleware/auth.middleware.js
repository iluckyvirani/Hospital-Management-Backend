const jwt = require("jsonwebtoken");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const prisma = require("../config/prisma");

const verifyJWT = asyncHandler(async (req, res, next) => {
  const token =
    req.cookies?.accessToken ||
    req.headers["authorization"]?.replace("Bearer ", "");

  if (!token) throw new ApiError(401, "Unauthorized - No token provided");

  const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    },
  });

  if (!user) throw new ApiError(401, "Unauthorized - Invalid token");
  if (user.status === "INACTIVE") throw new ApiError(403, "Account is deactivated");

  req.user = user;
  next();
});

module.exports = { verifyJWT };