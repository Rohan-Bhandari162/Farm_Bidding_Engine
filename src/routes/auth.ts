import { Router, Response } from "express";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { AuthenticatedRequest } from "../middleware/auth";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Registration Route
router.post("/register", async (req, res) => {
  const { email, password, role, name, businessTaxId, businessLicenseUrl } =
    req.body;

  if (!email || !password || !role || !name || !businessTaxId) {
    return res
      .status(400)
      .json({ error: "Missing required credentials or verification info" });
  }

  try {
    const userExists = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // New signups default to 'pending'
    const newUser = await pool.query(
      `INSERT INTO users (email, password, role, name, business_tax_id, business_license_url, status) 
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id, email, role, status`,
      [
        email,
        hashedPassword,
        role,
        name,
        businessTaxId,
        businessLicenseUrl || null,
      ],
    );

    res.status(201).json({
      message:
        "Registration successful. Your account is under verification review.",
      user: newUser.rows[0],
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error during registration" });
  }
});

// Login Route
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Embed account verification status in the token
    const token = jwt.sign(
      { id: user.id, role: user.role, status: user.status },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "1d" },
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error during login" });
  }
});

export default router;
