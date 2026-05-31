const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");

// ─── Generate Tokens ───────────────────────────────────────
const generateTokens = (user) => {
    const accessToken = jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: process.env.JWT_ACCESS_EXPIRY || "7d" }
    );

    const refreshToken = jwt.sign(
        { id: user.id },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRY || "7d" }
    );

    return { accessToken, refreshToken };
};

// ─── Login ─────────────────────────────────────────────────
const login = asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        throw new ApiError(400, "Username and password are required");
    }

    // Find user by username or email
    const user = await prisma.user.findFirst({
        where: {
            OR: [{ username }, { email: username }],
        },
    });

    if (!user) throw new ApiError(401, "Invalid credentials");
    if (user.status === "INACTIVE") throw new ApiError(403, "Account is deactivated. Contact admin");

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) throw new ApiError(401, "Invalid credentials");

    const { accessToken, refreshToken } = generateTokens(user);

    // Update last login
    await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
    });

    // Set refresh token in cookie
    res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return res.status(200).json(
        new ApiResponse(200, {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                status: user.status,
            },
            token: accessToken,
        }, "Login successful")
    );
});

// ─── Logout ────────────────────────────────────────────────
const logout = asyncHandler(async (req, res) => {
    res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Logged out successfully")
    );
});

// ─── Refresh Token ─────────────────────────────────────────
const refreshToken = asyncHandler(async (req, res) => {
    const token = req.cookies?.refreshToken;

    if (!token) throw new ApiError(401, "Refresh token missing");

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

    const user = await prisma.user.findUnique({
        where: { id: decoded.id },
    });

    if (!user) throw new ApiError(401, "Invalid refresh token");
    if (user.status === "INACTIVE") throw new ApiError(403, "Account is deactivated");

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    res.cookie("refreshToken", newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json(
        new ApiResponse(200, { accessToken }, "Token refreshed")
    );
});

// ─── Get Current User ──────────────────────────────────────
const getMe = asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            username: true,
            status: true,
            lastLogin: true,
            createdAt: true,
        },
    });

    return res.status(200).json(
        new ApiResponse(200, user, "User fetched successfully")
    );
});

// ─── Change Password ───────────────────────────────────────
const changePassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
        throw new ApiError(400, "Old and new password are required");
    }

    if (newPassword.length < 6) {
        throw new ApiError(400, "New password must be at least 6 characters");
    }

    const user = await prisma.user.findUnique({
        where: { id: req.user.id },
    });

    const isValid = await bcrypt.compare(oldPassword, user.password);
    if (!isValid) throw new ApiError(400, "Old password is incorrect");

    const hashed = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
        where: { id: req.user.id },
        data: { password: hashed },
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Password changed successfully")
    );
});

module.exports = { login, logout, refreshToken, getMe, changePassword };