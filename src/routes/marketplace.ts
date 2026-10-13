import { Router, Response } from "express";
import { Pool } from "pg";
import {
  requireAuth,
  isVerified,
  AuthenticatedRequest,
} from "../middleware/auth";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Create an auction (Farmers only, must be verified)
router.post(
  "/auctions",
  requireAuth,
  isVerified,
  async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== "farmer") {
      return res
        .status(403)
        .json({ error: "Only registered farmers can list produce auctions" });
    }

    const { title, description, startingBid, closingAt } = req.body;

    try {
      const result = await pool.query(
        `INSERT INTO auctions (farmer_id, title, description, starting_bid, current_bid, closing_at) 
       VALUES ($1, $2, $3, $4, $4, $5) RETURNING *`,
        [req.user.id, title, description, startingBid, closingAt],
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: "Failed to create auction listing" });
    }
  },
);

// Place a bid (Restaurants only, must be verified)
router.post(
  "/bids",
  requireAuth,
  isVerified,
  async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== "restaurant") {
      return res.status(403).json({
        error: "Only verified restaurants can place marketplace bids",
      });
    }

    const { auctionId, amount } = req.body;

    try {
      // Basic verification check to ensure bid is higher than current max bid
      const auctionRes = await pool.query(
        "SELECT current_bid FROM auctions WHERE id = $1",
        [auctionId],
      );
      if (auctionRes.rows.length === 0) {
        return res.status(404).json({ error: "Auction window not found" });
      }

      if (amount <= auctionRes.rows[0].current_bid) {
        return res
          .status(400)
          .json({ error: "Bid amount must exceed the current highest offer" });
      }

      await pool.query("BEGIN");

      await pool.query(
        "INSERT INTO bids (auction_id, restaurant_id, amount) VALUES ($1, $2, $3)",
        [auctionId, req.user.id, amount],
      );

      const updatedAuction = await pool.query(
        "UPDATE auctions SET current_bid = $1 WHERE id = $2 RETURNING *",
        [amount, auctionId],
      );

      await pool.query("COMMIT");
      res.status(201).json({
        message: "Bid recorded successfully",
        auction: updatedAuction.rows[0],
      });
    } catch (error) {
      await pool.query("ROLLBACK");
      res
        .status(500)
        .json({ error: "Transaction failed while submitting bid" });
    }
  },
);

export default router;
