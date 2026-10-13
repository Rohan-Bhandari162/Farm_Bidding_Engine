import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./db";
import { createServer } from "http";
import { Server } from "socket.io";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" }, //cross origin resource sharing tells who is allowed to connect
});

app.use(cors());
app.use(express.json());

io.on("connection", (socket) => {
  console.log(`new client connected to the market: ${socket.id}`);
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

app.get("/", (req: Request, res: Response) => {
  res.send("Welcome to the Farm-to-Restaurant Bidding Engine API");
});

//database connection check
app.get("/api/health", async (req: Request, res: Response) => {
  try {
    const dbResult = await pool.query("SELECT NOW()");
    res.status(200).json({
      status: "UP",
      database_time: dbResult.rows[0].now,
      message: "Farm Bidding Engine is running seamlessly.",
    });
  } catch (error) {
    res.status(500).json({
      status: "DOWN",
      error: "Database connection failed",
    });
  }
});

//create a user
app.post("/api/users", async (req: Request, res: Response) => {
  try {
    const { name, role, password } = req.body;
    if (!password || password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters long." });
    }
    if (role !== "FARMER" && role !== "RESTAURANT") {
      res
        .status(400)
        .json({ error: "Role must be strictly FARMER or RESTAURANT" });
      return;
    }
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const new_user = await pool.query(
      `INSERT INTO users (name, role, password) VALUES($1, $2, $3) RETURNING id, name, role`,
      [name, role, hashedPassword],
    );
    res.status(201).json({
      message: "User created successfully",
      user: new_user.rows[0],
    });
  } catch (error) {
    console.error(error),
      res.status(500).json({
        error: "Internal Server Error while creating user",
      });
  }
});

//secure login system
app.post("/api/login", async (req: Request, res: Response) => {
  try {
    const { name, password } = req.body;
    const userResult = await pool.query("SELECT * FROM users WHERE name=$1", [
      name,
    ]);
    if (userResult.rowCount === 0) {
      return res.status(401).json({
        error: "Invalid Creditials. ",
      });
    }
    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({
        error: "Invalid Credintial. ",
      });
    }
    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: "2h" },
    );
    res.status(200).json({
      message: "Login successful!",
      token: token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Internal Server Error during login",
    });
  }
});

const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({
      error: "Access Denied. You must be logged in.",
    });
  }
  jwt.verify(token, process.env.JWT_SECRET as string, (err, decodeUser) => {
    if (err) {
      return res.status(403).json({
        error: "Invalid or expired token. Please log in again.",
      });
    }
    (req as any).user = decodeUser;
    next();
  });
};

// Current logged in user profile
app.get("/api/me", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const userResult = await pool.query(
      "SELECT id, name, role FROM users WHERE id=$1",
      [userId]
    );
    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ user: userResult.rows[0] });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user profile" });
  }
});

// List all auctions with farmer name and highest bidder restaurant
app.get("/api/auctions", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT 
        a.*, 
        u.name as farmer_name,
        hb.restaurant_id as highest_bidder_id,
        ru.name as highest_bidder_name
      FROM auctions a
      LEFT JOIN users u ON a.farmer_id = u.id
      LEFT JOIN LATERAL (
        SELECT b.restaurant_id, b.bid_amount 
        FROM bids b 
        WHERE b.auction_id = a.id 
        ORDER BY b.bid_amount DESC, b.created_at DESC 
        LIMIT 1
      ) hb ON true
      LEFT JOIN users ru ON hb.restaurant_id = ru.id
      ORDER BY a.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Fetch auctions error:", error);
    res.status(500).json({ error: "Failed to fetch auctions" });
  }
});

// Delete an auction (Farmer only)
app.delete(
  "/api/auctions/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const auctionId = req.params.id;
      const farmerId = (req as any).user.id;

      const check = await pool.query("SELECT * FROM auctions WHERE id = $1", [
        auctionId,
      ]);
      if (check.rowCount === 0) {
        return res.status(404).json({ error: "Auction not found" });
      }

      if (check.rows[0].farmer_id !== farmerId) {
        return res
          .status(403)
          .json({ error: "Forbidden. You can only delete your own auctions." });
      }

      await pool.query("DELETE FROM bids WHERE auction_id = $1", [auctionId]);
      await pool.query("DELETE FROM auctions WHERE id = $1", [auctionId]);

      io.emit("auction_deleted", { auction_id: Number(auctionId) });

      res.json({ message: "Auction deleted successfully" });
    } catch (error) {
      console.error("Delete auction error:", error);
      res.status(500).json({ error: "Failed to delete auction" });
    }
  },
);

//create a new auction
app.post(
  "/api/auctions",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { item_name, quantity, starting_price, end_time } = req.body;
      const farmer_id = (req as any).user.id;
      const userCheck = await pool.query("SELECT id, name, role FROM users WHERE id=$1", [
        farmer_id,
      ]);
      if (userCheck.rowCount === 0) {
        return res.status(404).json({
          error: "User not found in the database.",
        });
      }
      if (userCheck.rows[0].role !== "FARMER") {
        return res.status(403).json({
          error: "Forbidden. Only registered farmers can create auctions.",
        });
      }
      const newAuction = await pool.query(
        `INSERT INTO auctions (farmer_id, item_name, quantity, starting_price, end_time)
            VALUES($1, $2, $3, $4, $5) RETURNING *`,
        [farmer_id, item_name, quantity, starting_price, end_time],
      );

      const createdAuction = {
        ...newAuction.rows[0],
        farmer_name: userCheck.rows[0].name,
      };

      // Notify all connected clients of new auction
      io.emit("auction_created", {
        message: "New produce auction listed!",
        auction: createdAuction,
      });

      res.status(201).json({
        message: "Auction deployed successfully!",
        auction: createdAuction,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Internal Server Error while creating the auction.",
      });
    }
  },
);

//bidding-engine
app.post(
  "/api/bids",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { auction_id, bid_amount } = req.body;
    const restaurant_id = (req as any).user.id;
    if (!auction_id || !restaurant_id || !bid_amount) {
      return res.status(400).json({ error: "All fields are required." });
    }
    if (bid_amount <= 0) {
      return res.status(400).json({ error: "Bid amount must be positive." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userCheck = await client.query(
        `SELECT id, name, role FROM users WHERE id=$1`,
        [restaurant_id],
      );
      if (userCheck.rowCount === 0) {
        throw new Error("Restaurant does not exist.");
      }
      if (userCheck.rows[0].role !== "RESTAURANT") {
        throw new Error("Only restaurants can bid.");
      }
      const auctionRes = await client.query(
        `SELECT * FROM auctions WHERE id=$1 FOR UPDATE`,
        [auction_id],
      );
      if (auctionRes.rowCount === 0) {
        throw new Error("Auction not found.");
      }
      const auction = auctionRes.rows[0];
      if (new Date(auction.end_time) <= new Date()) {
        throw new Error("Auction has already ended.");
      }
      if (auction.farmer_id === restaurant_id) {
        throw new Error("You cannot bid on your own auction.");
      }
      const currentBid = parseFloat(auction.current_highest_bid);
      const startingPrice = parseFloat(auction.starting_price);
      if (currentBid === 0 && bid_amount < startingPrice) {
        throw new Error(
          `Bid must be at least the starting price of ₹${startingPrice}`,
        );
      } else if (currentBid > 0 && bid_amount <= currentBid) {
        throw new Error(`Bid must be strictly higher than ₹${currentBid}`);
      }
      const auctionUpdate = await client.query(
        `UPDATE auctions SET current_highest_bid=$1 WHERE id=$2 RETURNING *`,
        [bid_amount, auction_id],
      );
      const newBid = await client.query(
        `INSERT INTO bids (auction_id, restaurant_id, bid_amount) VALUES ($1, $2, $3) RETURNING *`,
        [auction_id, restaurant_id, bid_amount],
      );
      await client.query("COMMIT");
      io.emit("market_update", {
        message: "NEW HIGH BID!",
        auction_id: auction_id,
        new_bid: bid_amount,
        winner_id: restaurant_id,
        winner_name: userCheck.rows[0].name,
        item_name: auction.item_name,
      });
      return res.status(201).json({
        message: "Bid accepted successfully.",
        bid: newBid.rows[0],
        auction_status: auctionUpdate.rows[0],
      });
    } catch (error: any) {
      await client.query("ROLLBACK");
      console.error("Transaction Error:", error.message);
      return res
        .status(400)
        .json({ error: error.message || "Transaction failed." });
    } finally {
      client.release();
    }
  },
);

//highest bid get from db
app.get("/api/bids/highest", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT bid_amount, restaurant_id FROM bids ORDER BY bid_amount DESC LIMIT 1",
    );
    if (result.rowCount && result.rowCount > 0) {
      res.json({
        new_bid: result.rows[0].bid_amount,
        winner_id: result.rows[0].restaurant_id,
      });
    } else {
      res.json(null);
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch highest bid" });
  }
});
//server alert
// Correct:
httpServer.listen(PORT, () => {
  console.log(
    `Bidding server & WebSockets running on http://localhost:${PORT}`,
  );
});
