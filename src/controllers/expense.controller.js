const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");

// ─── Get All Expenses ──────────────────────────────────────
const getAllExpenses = asyncHandler(async (req, res) => {
  const { search, categoryId, from, to, page = 1, limit = 20 } = req.query;

  const where = {};
  if (categoryId) where.categoryId = categoryId;

  if (from || to) {
    where.expenseDate = {};
    if (from) where.expenseDate.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.expenseDate.lte = toDate;
    }
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { paidTo: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: {
        category: true,
        creator: { select: { name: true } },
      },
      orderBy: { expenseDate: "desc" },
      skip,
      take: parseInt(limit),
    }),
    prisma.expense.count({ where }),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      expenses,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }, "Expenses fetched successfully")
  );
});

// ─── Create Expense ────────────────────────────────────────
const createExpense = asyncHandler(async (req, res) => {
  const {
    title, categoryId, amount, expenseDate,
    paymentMode, paidTo, description,
    isRecurring, frequency,
  } = req.body;

  if (!title || !categoryId || !amount || !expenseDate || !paymentMode) {
    throw new ApiError(400, "title, categoryId, amount, expenseDate and paymentMode are required");
  }

  const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new ApiError(404, "Category not found");

  const receiptFile = req.file ? req.file.path : null;

  const expense = await prisma.expense.create({
    data: {
      title,
      categoryId,
      amount: parseFloat(amount),
      expenseDate: new Date(expenseDate),
      paymentMode,
      paidTo,
      description,
      receiptFile,
      isRecurring: isRecurring === true || isRecurring === "true" || false,
      frequency: frequency || null,
      createdBy: req.user.id,
    },
    include: { category: true },
  });

  return res.status(201).json(
    new ApiResponse(201, expense, "Expense created successfully")
  );
});

// ─── Update Expense ────────────────────────────────────────
const updateExpense = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    title, categoryId, amount, expenseDate,
    paymentMode, paidTo, description,
    isRecurring, frequency,
  } = req.body;

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) throw new ApiError(404, "Expense not found");

  const receiptFile = req.file ? req.file.path : undefined;

  const updated = await prisma.expense.update({
    where: { id },
    data: {
      ...(title && { title }),
      ...(categoryId && { categoryId }),
      ...(amount && { amount: parseFloat(amount) }),
      ...(expenseDate && { expenseDate: new Date(expenseDate) }),
      ...(paymentMode && { paymentMode }),
      ...(paidTo !== undefined && { paidTo }),
      ...(description !== undefined && { description }),
      ...(isRecurring !== undefined && { isRecurring: isRecurring === true || isRecurring === "true" }),
      ...(frequency !== undefined && { frequency }),
      ...(receiptFile && { receiptFile }),
    },
    include: { category: true },
  });

  return res.status(200).json(
    new ApiResponse(200, updated, "Expense updated successfully")
  );
});

// ─── Delete Expense ────────────────────────────────────────
const deleteExpense = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) throw new ApiError(404, "Expense not found");

  await prisma.expense.delete({ where: { id } });

  return res.status(200).json(
    new ApiResponse(200, {}, "Expense deleted successfully")
  );
});

// ─── Get Expense Categories ────────────────────────────────
const getExpenseCategories = asyncHandler(async (req, res) => {
  const categories = await prisma.expenseCategory.findMany({
    include: {
      _count: { select: { expenses: true } },
    },
    orderBy: { name: "asc" },
  });

  return res.status(200).json(
    new ApiResponse(200, categories, "Expense categories fetched successfully")
  );
});

// ─── Create Expense Category ───────────────────────────────
const createExpenseCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  if (!name) throw new ApiError(400, "Category name is required");

  const existing = await prisma.expenseCategory.findUnique({ where: { name } });
  if (existing) throw new ApiError(409, "Category already exists");

  const category = await prisma.expenseCategory.create({
    data: { name, description },
  });

  return res.status(201).json(
    new ApiResponse(201, category, "Expense category created successfully")
  );
});

// ─── Get Expense Stats ─────────────────────────────────────
const getExpenseStats = asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const startOfWeek = new Date(today);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfYear = new Date(today.getFullYear(), 0, 1);

  const [todayTotal, weekTotal, monthTotal, yearTotal, categoryBreakdown] = await Promise.all([
    prisma.expense.aggregate({
      where: { expenseDate: { gte: today, lt: tomorrow } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { expenseDate: { gte: startOfWeek } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { expenseDate: { gte: startOfMonth } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { expenseDate: { gte: startOfYear } },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["categoryId"],
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  // Enrich category breakdown with names
  const categories = await prisma.expenseCategory.findMany();
  const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  const breakdown = categoryBreakdown.map((item) => ({
    category: categoryMap[item.categoryId] || "Unknown",
    categoryId: item.categoryId,
    total: item._sum.amount || 0,
    count: item._count,
  }));

  return res.status(200).json(
    new ApiResponse(200, {
      today: todayTotal._sum.amount || 0,
      week: weekTotal._sum.amount || 0,
      month: monthTotal._sum.amount || 0,
      year: yearTotal._sum.amount || 0,
      categoryBreakdown: breakdown,
    }, "Expense stats fetched successfully")
  );
});

module.exports = {
  getAllExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  getExpenseCategories,
  createExpenseCategory,
  getExpenseStats,
};
