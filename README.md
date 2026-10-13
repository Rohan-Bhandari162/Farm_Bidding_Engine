# 🌾 Farm Bidding Engine

A high-performance, real-time wholesale produce auction platform connecting **Farmers** directly with **Restaurants**. Built to eliminate middlemen, provide fair prices to agricultural producers, and give culinary businesses direct access to fresh, farm-grade harvest.

---

## 🌟 Key Features

### 🚜 Farmer Portal (Green Agriculture Theme)
- **Produce Auction Deployment**: List harvest items with produce name, batch quantity (e.g., `100 kg`, `50 crates`), starting base price, and custom closing date/time.
- **Smart Duration Presets**: Quick duration selectors (`+2 Hours`, `+12 Hours`, `+24 Hours / Tomorrow`, `+3 Days`) with automatic local time conversion.
- **Produce Management**: Track personal produce listings, starting bids, and live incoming buyer offers.
- **Real-Time Bidding Alerts**: Instant WebSocket notification when restaurants place competitive bids on your produce.

### 🍽️ Restaurant Buyer Portal (Amber Gastronomy Theme)
- **Live Wholesale Marketplace**: Browse active produce auctions across regional farms with transparent farmer identities.
- **One-Click Quick Bidding**: Fast bid chips (`Min Required`, `+₹50`, `+₹100`, `+₹500`) to outbid competitors instantly.
- **Live Time Remaining & Expiry**: Dynamic countdown timers (`LIVE • 4h left`) and precise closing timestamps.
- **Instant Outbid Alerts**: Real-time push notifications whenever a competing restaurant places a higher bid.

### 🔒 Enterprise Architecture & Concurrency Control
- **Anti-Race Condition Bidding Engine**: Uses PostgreSQL **Row-Level Locking** (`SELECT ... FOR UPDATE`) inside ACID transactions (`BEGIN` / `COMMIT` / `ROLLBACK`) to guarantee that concurrent simultaneous bids are serialized without data conflicts or stale overwrites.
- **Strict Role-Based Access Control (RBAC)**: Only verified `FARMER` accounts can create produce listings; only verified `RESTAURANT` accounts can place bids. Farmers are strictly prevented from bidding on their own produce.
- **Timezone Drift Protection**: Migrated to PostgreSQL `TIMESTAMPTZ` with ISO 8601 UTC normalization to ensure zero timezone drift between server, database, and client browsers.
- **Modern Glassmorphic UI**: Custom Vanilla CSS with blurred backdrop glass panels, smooth status pulsing micro-animations, and responsive mobile-first layouts.

---

## 🛠️ Tech Stack

### Backend
- **Runtime & Language**: Node.js & TypeScript
- **Web Framework**: Express.js 5
- **Real-Time Engine**: Socket.io
- **Database**: PostgreSQL with `pg` connection pooling
- **Security**: JSON Web Tokens (JWT) & `bcrypt` password hashing
- **Development Tooling**: `ts-node-dev` with instant hot-reloading

### Frontend
- **Framework**: React 19 + TypeScript
- **Build Tool**: Vite 8
- **Real-Time Client**: Socket.io Client
- **Design System**: Vanilla CSS (Dark Mode Glassmorphism, CSS Variables, Flexbox/Grid)
- **Typography**: Plus Jakarta Sans & JetBrains Mono

---

## 📂 Project Structure

```
farm-bidding-engine/
├── .env                       # Environment configuration
├── package.json               # Backend dependencies & dev scripts
├── tsconfig.json              # Backend TypeScript configuration
├── src/                       # Backend Source Code
│   ├── db.ts                  # PostgreSQL connection pool configuration
│   ├── index.ts               # Express server, WebSockets & API routes
│   ├── middleware/            # Auth & verification middleware
│   └── routes/                # Modular route handlers
└── frontend/                  # Frontend Client (React + Vite)
    ├── package.json           # Frontend dependencies & scripts
    ├── vite.config.ts         # Vite configuration
    └── src/
        ├── App.tsx            # Main application component & role views
        ├── App.css            # Glassmorphism design system & portal styles
        ├── index.css          # Base resets & color variables
        └── main.tsx           # React DOM bootstrap
```

---

## ⚙️ Database Schema

### 1. `users`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `SERIAL PRIMARY KEY` | Unique user identifier |
| `name` | `VARCHAR(255)` | Business or individual name |
| `role` | `VARCHAR(50)` | Strictly `'FARMER'` or `'RESTAURANT'` |
| `password` | `VARCHAR(255)` | Salted bcrypt hash |
| `created_at` | `TIMESTAMPTZ` | Registration timestamp |

### 2. `auctions`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `SERIAL PRIMARY KEY` | Unique auction listing identifier |
| `farmer_id` | `INT REFERENCES users(id)` | Farm producer who listed the harvest |
| `item_name` | `VARCHAR(255)` | Produce name (e.g., Kashmiri Apples) |
| `quantity` | `VARCHAR(100)` | Available batch volume (e.g., 100 kg) |
| `starting_price` | `NUMERIC(12, 2)` | Minimum opening bid |
| `current_highest_bid` | `NUMERIC(12, 2)` | Highest active bid |
| `end_time` | `TIMESTAMPTZ` | Auction closing date & time |
| `is_active` | `BOOLEAN` | Listing active flag |
| `status` | `VARCHAR(50)` | Auction state (`'OPEN'`, `'CLOSED'`) |
| `created_at` | `TIMESTAMPTZ` | Creation timestamp |

### 3. `bids`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `SERIAL PRIMARY KEY` | Unique bid identifier |
| `auction_id` | `INT REFERENCES auctions(id)` | Target auction |
| `restaurant_id` | `INT REFERENCES users(id)` | Restaurant bidder |
| `bid_amount` | `NUMERIC(12, 2)` | Submitted bid amount |
| `created_at` | `TIMESTAMPTZ` | Bid timestamp |

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** (v18 or higher)
- **PostgreSQL** (v14 or higher) running locally or remotely

### 2. Configure Environment (`.env`)
Create a `.env` file in the root directory:
```env
PORT=3000
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=bidding_engine
JWT_SECRET=your_super_secret_jwt_key
```

### 3. Install Dependencies
```bash
# Install backend dependencies
npm install

# Install frontend dependencies
npm --prefix frontend install
```

### 4. Run Locally

#### Start the Backend Server:
```bash
npm run dev
```
*Backend runs on `http://localhost:3000` with WebSocket listeners active.*

#### Start the Frontend Client:
```bash
npm --prefix frontend run dev
```
*Frontend runs on `http://localhost:5173` with Vite HMR.*

---

## 📡 API Reference

### Authentication
- `POST /api/users` — Register a new account (`name`, `role: "FARMER" | "RESTAURANT"`, `password >= 6 chars`).
- `POST /api/login` — Sign in with credentials, returns JWT token & user payload.
- `GET /api/me` — Retrieve active session profile using `Authorization: Bearer <token>`.

### Marketplace & Auctions
- `GET /api/auctions` — List all produce auctions with seller information.
- `POST /api/auctions` — Create a new produce listing *(Farmer only, Bearer Token required)*.
- `POST /api/bids` — Place a bid with ACID concurrency locks *(Restaurant only, Bearer Token required)*.
- `GET /api/bids/highest` — Fetch the global leading bid.
- `GET /api/health` — Check database connection and server status.

### Real-Time WebSocket Events
- `market_update` — Broadcasted to all connected clients on every accepted bid with `auction_id`, `new_bid`, `winner_name`, and `item_name`.
- `auction_created` — Broadcasted to all clients whenever a farmer launches a new produce auction.

---

## 🧪 Testing with Demo Accounts
The frontend login screen includes one-click demo credentials:
- **🌾 Farmer Account**: `Rohan bhandari` / `supersecretpassword`
- **🍽️ Restaurant Account**: `The Secure Spoon` / `supersecretpassword`

You can also use the **Create Account (Sign Up)** tab to instantly register your own custom Farmer or Restaurant profiles!

---

## 🛡️ License
ISC License.
