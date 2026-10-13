import React, { useEffect, useState, useMemo } from "react";
import { io } from "socket.io-client";
import "./App.css";

const API_BASE = "http://localhost:3000";
const socket = io(API_BASE, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});

interface User {
  id: number;
  name: string;
  role: "FARMER" | "RESTAURANT";
}

interface Auction {
  id: number;
  farmer_id: number;
  farmer_name?: string;
  item_name: string;
  quantity: string;
  starting_price: string;
  current_highest_bid: string;
  highest_bidder_id?: number | null;
  highest_bidder_name?: string | null;
  end_time: string;
  is_active: boolean;
  status: string;
  created_at?: string;
}

interface ToastMessage {
  id: string;
  type: "success" | "info" | "error";
  text: string;
}

// Helper to format local date to YYYY-MM-DDTHH:mm
const formatLocalInputDate = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${mins}`;
};

export default function App() {
  // Authentication & Profile State
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem("marketUser");
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string>(
    () => localStorage.getItem("marketToken") || ""
  );

  // Auth Form State
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authRole, setAuthRole] = useState<"FARMER" | "RESTAURANT">("FARMER");
  const [authLoading, setAuthLoading] = useState(false);

  // App Data State
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [activeTab, setActiveTab] = useState<"market" | "my-listings" | "create">("market");
  const [farmerSubFilter, setFarmerSubFilter] = useState<"all" | "active" | "concluded">("all");
  const [bidInputs, setBidInputs] = useState<{ [auctionId: number]: string }>({});
  const [socketConnected, setSocketConnected] = useState(() => socket.connected);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Create Auction Form State (Farmer) - defaults to 24h from now
  const [newProduce, setNewProduce] = useState(() => {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    return {
      item_name: "",
      quantity: "",
      starting_price: "",
      end_time: formatLocalInputDate(tomorrow),
    };
  });
  const [creatingAuction, setCreatingAuction] = useState(false);

  const addToast = (text: string, type: "success" | "info" | "error" = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  // Helper to calculate auction remaining time and validity
  const getAuctionTimeStatus = (dateStr: string) => {
    const endTime = new Date(dateStr).getTime();
    const now = Date.now();
    const diffMs = endTime - now;
    const isExpired = diffMs <= 0;

    const formattedDate = new Date(dateStr).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    if (isExpired) {
      return {
        isExpired: true,
        label: "CONCLUDED",
        remainingText: "Concluded",
        formattedDate,
      };
    }

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    let remainingText = "";
    if (diffHours >= 24) {
      const days = Math.floor(diffHours / 24);
      remainingText = `${days}d ${diffHours % 24}h left`;
    } else if (diffHours > 0) {
      remainingText = `${diffHours}h ${diffMins}m left`;
    } else {
      remainingText = `${Math.max(1, diffMins)}m left`;
    }

    return {
      isExpired: false,
      label: "LIVE",
      remainingText,
      formattedDate,
    };
  };

  // Quick preset helper for closing time
  const setDurationOffset = (hours: number) => {
    const future = new Date(Date.now() + hours * 3600 * 1000);
    setNewProduce((prev) => ({
      ...prev,
      end_time: formatLocalInputDate(future),
    }));
  };

  // Fetch all auctions
  const fetchAuctions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auctions`);
      if (res.ok) {
        const data = await res.json();
        setAuctions(data);
      }
    } catch (err) {
      console.error("Failed to load auctions", err);
    }
  };

  // Check auth session
  useEffect(() => {
    if (token && !user) {
      fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.user) {
            setUser(data.user);
            localStorage.setItem("marketUser", JSON.stringify(data.user));
          } else {
            handleLogout();
          }
        })
        .catch(() => handleLogout());
    }
  }, [token]);

  // Initial Load & Socket listeners
  useEffect(() => {
    fetchAuctions();

    // Immediately synchronize connection state
    if (socket.connected) {
      setSocketConnected(true);
    } else {
      socket.connect();
    }

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    const onConnectError = () => setSocketConnected(false);

    const onMarketUpdate = (data: any) => {
      setAuctions((prev) =>
        prev.map((auc) =>
          auc.id === Number(data.auction_id)
            ? {
                ...auc,
                current_highest_bid: data.new_bid.toString(),
                highest_bidder_id: data.winner_id,
                highest_bidder_name: data.winner_name,
              }
            : auc
        )
      );
      addToast(
        `⚡ New Highest Bid: ₹${data.new_bid} on ${data.item_name || "produce"} by ${data.winner_name || "Restaurant"}!`,
        "info"
      );
    };

    const onAuctionCreated = (data: any) => {
      if (data.auction) {
        setAuctions((prev) => [data.auction, ...prev]);
        addToast(
          `🌾 New Produce Listed: ${data.auction.item_name} by ${data.auction.farmer_name || "Farmer"}!`,
          "success"
        );
      }
    };

    const onAuctionDeleted = (data: any) => {
      setAuctions((prev) => prev.filter((auc) => auc.id !== Number(data.auction_id)));
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("market_update", onMarketUpdate);
    socket.on("auction_created", onAuctionCreated);
    socket.on("auction_deleted", onAuctionDeleted);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("market_update", onMarketUpdate);
      socket.off("auction_created", onAuctionCreated);
      socket.off("auction_deleted", onAuctionDeleted);
    };
  }, []);

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: authName.trim(), password: authPassword }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setToken(data.token);
        localStorage.setItem("marketToken", data.token);

        if (data.user) {
          setUser(data.user);
          localStorage.setItem("marketUser", JSON.stringify(data.user));
        }

        addToast(`Welcome back, ${data.user?.name || authName}!`, "success");
        setAuthPassword("");
      } else {
        addToast(data.error || "Login failed. Check your credentials.", "error");
      }
    } catch (err) {
      addToast("Server connection error. Please make sure the backend is running.", "error");
    } finally {
      setAuthLoading(false);
    }
  };

  // Handle Sign Up (Registration)
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authPassword.length < 6) {
      addToast("Password must be at least 6 characters long.", "error");
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: authName.trim(),
          role: authRole,
          password: authPassword,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        addToast("Account created successfully! Logging you in...", "success");

        // Immediately log the new user in
        const loginRes = await fetch(`${API_BASE}/api/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: authName.trim(), password: authPassword }),
        });
        const loginData = await loginRes.json();
        if (loginRes.ok && loginData.token) {
          setToken(loginData.token);
          localStorage.setItem("marketToken", loginData.token);
          if (loginData.user) {
            setUser(loginData.user);
            localStorage.setItem("marketUser", JSON.stringify(loginData.user));
          }
          setAuthPassword("");
        }
      } else {
        addToast(data.error || "Registration failed.", "error");
      }
    } catch (err) {
      addToast("Server connection error during registration.", "error");
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout
  const handleLogout = () => {
    localStorage.removeItem("marketToken");
    localStorage.removeItem("marketUser");
    setToken("");
    setUser(null);
    setActiveTab("market");
    addToast("Logged out of market portal.", "info");
  };

  // Farmer: Create Auction
  const handleCreateAuction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || user?.role !== "FARMER") return;

    if (!newProduce.item_name || !newProduce.quantity || !newProduce.starting_price || !newProduce.end_time) {
      addToast("Please fill in all listing details.", "error");
      return;
    }

    const closingDate = new Date(newProduce.end_time);
    if (isNaN(closingDate.getTime())) {
      addToast("Please enter a valid closing date and time.", "error");
      return;
    }

    if (closingDate.getTime() <= Date.now()) {
      addToast("Auction closing time must be in the future. Please pick a later time.", "error");
      return;
    }

    setCreatingAuction(true);
    try {
      const res = await fetch(`${API_BASE}/api/auctions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          item_name: newProduce.item_name.trim(),
          quantity: newProduce.quantity.trim(),
          starting_price: Number(newProduce.starting_price),
          end_time: closingDate.toISOString(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        addToast(`Produce "${newProduce.item_name}" listed successfully!`, "success");
        const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
        setNewProduce({
          item_name: "",
          quantity: "",
          starting_price: "",
          end_time: formatLocalInputDate(tomorrow),
        });
        setActiveTab("my-listings");
        fetchAuctions();
      } else {
        addToast(data.error || "Failed to create auction.", "error");
      }
    } catch (err) {
      addToast("Error contacting server.", "error");
    } finally {
      setCreatingAuction(false);
    }
  };

  // Farmer: Delete Auction
  const handleDeleteAuction = async (auctionId: number) => {
    if (!token || user?.role !== "FARMER") return;
    if (!window.confirm("Are you sure you want to permanently delete this listing?")) return;

    try {
      const res = await fetch(`${API_BASE}/api/auctions/${auctionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        addToast("Listing removed successfully.", "info");
        setAuctions((prev) => prev.filter((a) => a.id !== auctionId));
      } else {
        const d = await res.json();
        addToast(d.error || "Failed to delete listing.", "error");
      }
    } catch {
      addToast("Server communication error.", "error");
    }
  };

  // Restaurant: Place Bid
  const handlePlaceBid = async (auction: Auction) => {
    if (!token) {
      addToast("Please sign in as a Restaurant to place bids.", "error");
      return;
    }
    if (user?.role !== "RESTAURANT") {
      addToast("Only registered restaurants can place bids.", "error");
      return;
    }

    const amount = Number(bidInputs[auction.id]);
    const currentHigh = Number(auction.current_highest_bid || 0);
    const startPrice = Number(auction.starting_price || 0);

    const minRequired = currentHigh > 0 ? currentHigh + 1 : startPrice;

    if (!amount || amount < minRequired) {
      addToast(`Bid must be at least ₹${minRequired.toLocaleString()}.`, "error");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/bids`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          auction_id: auction.id,
          bid_amount: amount,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        addToast(`Your bid of ₹${amount.toLocaleString()} was accepted on ${auction.item_name}!`, "success");
        setBidInputs((prev) => ({ ...prev, [auction.id]: "" }));
        fetchAuctions();
      } else {
        addToast(data.error || "Bid could not be accepted.", "error");
      }
    } catch (err) {
      addToast("Server communication error.", "error");
    }
  };

  // Farmer's auctions summary counts
  const farmerAuctions = useMemo(() => {
    if (!user || user.role !== "FARMER") return [];
    return auctions.filter((a) => a.farmer_id === user.id);
  }, [auctions, user]);

  const activeFarmerCount = useMemo(() => {
    const now = Date.now();
    return farmerAuctions.filter((a) => new Date(a.end_time).getTime() > now).length;
  }, [farmerAuctions]);

  const concludedFarmerCount = useMemo(() => {
    const now = Date.now();
    return farmerAuctions.filter((a) => new Date(a.end_time).getTime() <= now).length;
  }, [farmerAuctions]);

  // Filtered auctions based on role and tab
  const displayedAuctions = useMemo(() => {
    const now = Date.now();

    // FARMER'S PRODUCE LISTINGS
    if (activeTab === "my-listings" && user?.role === "FARMER") {
      if (farmerSubFilter === "active") {
        return farmerAuctions.filter((a) => new Date(a.end_time).getTime() > now);
      }
      if (farmerSubFilter === "concluded") {
        return farmerAuctions.filter((a) => new Date(a.end_time).getTime() <= now);
      }
      return farmerAuctions;
    }

    // MAIN LIVE PRODUCE MARKET: ONLY show live / active auctions!
    // As requested: "delete all those bids which got ended from frontend and only show the live bids"
    return auctions.filter((a) => new Date(a.end_time).getTime() > now);
  }, [auctions, activeTab, user, farmerSubFilter, farmerAuctions]);

  return (
    <div className="app-shell">
      {/* Top Navigation */}
      <header className="navbar">
        <div className="brand">
          <span className="brand-icon">🌱</span>
          <div className="brand-text">
            <h1>Farm Bidding Engine</h1>
            <p>Direct Farmer-to-Restaurant Wholesale Exchange</p>
          </div>
        </div>

        <div className="nav-actions">
          {/* Real-time Socket Indicator */}
          <div className={`socket-badge ${socketConnected ? "socket-connected" : ""}`}>
            <span className="socket-dot" />
            <span>{socketConnected ? "LIVE MARKET" : "CONNECTING..."}</span>
          </div>

          {/* User Profile / Status */}
          {user ? (
            <div className="user-profile-badge">
              <span
                className={`role-tag ${
                  user.role === "FARMER" ? "role-farmer-tag" : "role-restaurant-tag"
                }`}
              >
                {user.role === "FARMER" ? "🌾 Farmer" : "🍽️ Restaurant"}
              </span>
              <span className="user-name">{user.name}</span>
              <button className="btn-nav-logout" onClick={handleLogout} title="Log out">
                Sign Out
              </button>
            </div>
          ) : (
            <button
              className="btn-nav-logout"
              style={{ color: "#38bdf8", borderColor: "rgba(56, 189, 248, 0.4)" }}
              onClick={() => window.scrollTo({ top: 300, behavior: "smooth" })}
            >
              Sign In / Register
            </button>
          )}
        </div>
      </header>

      {/* Main Body */}
      <main className="main-content">
        {/* Banner based on user role */}
        {user ? (
          <div
            className={`portal-banner ${
              user.role === "FARMER" ? "theme-farmer" : "theme-restaurant"
            }`}
          >
            <div className="portal-info">
              <h2>
                {user.role === "FARMER"
                  ? `🌾 Farmer Portal: Welcome, ${user.name}`
                  : `🍽️ Restaurant Buyer Portal: Welcome, ${user.name}`}
              </h2>
              <p>
                {user.role === "FARMER"
                  ? "Publish your fresh produce auctions and monitor live competing bids from restaurants."
                  : "Bid on live farm-fresh produce directly from local farmers at competitive wholesale prices."}
              </p>
            </div>

            {user.role === "FARMER" && (
              <button
                className="banner-action-btn"
                onClick={() =>
                  setActiveTab(activeTab === "create" ? "my-listings" : "create")
                }
              >
                {activeTab === "create" ? "View My Listings" : "+ List New Produce"}
              </button>
            )}
          </div>
        ) : null}

        {/* If user is logged in: Role-based Navigation Tabs */}
        {user && (
          <div className="view-tabs">
            <button
              className={`view-tab ${
                activeTab === "market"
                  ? user.role === "FARMER"
                    ? "active-farmer"
                    : "active-restaurant"
                  : ""
              }`}
              onClick={() => setActiveTab("market")}
            >
              🌾 Live Marketplace (Active Only)
            </button>

            {user.role === "FARMER" && (
              <>
                <button
                  className={`view-tab ${
                    activeTab === "my-listings" ? "active-farmer" : ""
                  }`}
                  onClick={() => setActiveTab("my-listings")}
                >
                  📦 My Produce Listings ({farmerAuctions.length})
                </button>
                <button
                  className={`view-tab ${
                    activeTab === "create" ? "active-farmer" : ""
                  }`}
                  onClick={() => setActiveTab("create")}
                >
                  + Add New Auction
                </button>
              </>
            )}
          </div>
        )}

        {/* Sub-filter tabs for Farmer on "My Produce Listings" */}
        {user?.role === "FARMER" && activeTab === "my-listings" && (
          <div className="sub-tabs-bar">
            <button
              className={`sub-tab-btn ${farmerSubFilter === "all" ? "sub-tab-active" : ""}`}
              onClick={() => setFarmerSubFilter("all")}
            >
              All Listings ({farmerAuctions.length})
            </button>
            <button
              className={`sub-tab-btn ${farmerSubFilter === "active" ? "sub-tab-active" : ""}`}
              onClick={() => setFarmerSubFilter("active")}
            >
              🟢 Live Bidding ({activeFarmerCount})
            </button>
            <button
              className={`sub-tab-btn ${farmerSubFilter === "concluded" ? "sub-tab-active" : ""}`}
              onClick={() => setFarmerSubFilter("concluded")}
            >
              🏆 Concluded / Sold ({concludedFarmerCount})
            </button>
          </div>
        )}

        {/* CREATE AUCTION FORM (Farmer only) */}
        {user?.role === "FARMER" && activeTab === "create" && (
          <div className="create-auction-card">
            <div style={{ marginBottom: "1.5rem" }}>
              <h2 style={{ margin: "0 0 0.5rem 0", color: "#10b981", fontSize: "1.6rem" }}>
                🌾 List New Produce for Bidding
              </h2>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.9rem" }}>
                Set starting price and closing time. Certified restaurants will compete with live bids.
              </p>
            </div>

            <form onSubmit={handleCreateAuction}>
              <div className="form-group">
                <label>Produce / Item Name</label>
                <input
                  className="app-input"
                  placeholder="e.g. Ghani Sarso Ka Tel, Organic Kashmiri Apples, Fresh Basil"
                  value={newProduce.item_name}
                  onChange={(e) =>
                    setNewProduce({ ...newProduce, item_name: e.target.value })
                  }
                  required
                />
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label>Quantity / Unit</label>
                  <input
                    className="app-input"
                    placeholder="e.g. 50 Litres, 150 kg, 20 crates"
                    value={newProduce.quantity}
                    onChange={(e) =>
                      setNewProduce({ ...newProduce, quantity: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Starting Minimum Price (₹)</label>
                  <input
                    className="app-input"
                    type="number"
                    min="1"
                    placeholder="e.g. 500"
                    value={newProduce.starting_price}
                    onChange={(e) =>
                      setNewProduce({ ...newProduce, starting_price: e.target.value })
                    }
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Auction Closing Date & Time (Local Time)</label>
                <input
                  className="app-input"
                  type="datetime-local"
                  min={formatLocalInputDate(new Date())}
                  value={newProduce.end_time}
                  onChange={(e) =>
                    setNewProduce({ ...newProduce, end_time: e.target.value })
                  }
                  required
                />

                {/* Duration Presets */}
                <div className="duration-presets">
                  <span style={{ fontSize: "0.75rem", color: "var(--text-dim)", alignSelf: "center" }}>
                    Quick presets:
                  </span>
                  <button
                    type="button"
                    className="duration-chip"
                    onClick={() => setDurationOffset(2)}
                  >
                    + 2 Hours
                  </button>
                  <button
                    type="button"
                    className="duration-chip"
                    onClick={() => setDurationOffset(12)}
                  >
                    + 12 Hours
                  </button>
                  <button
                    type="button"
                    className="duration-chip"
                    onClick={() => setDurationOffset(24)}
                  >
                    + 24 Hours (Tomorrow)
                  </button>
                  <button
                    type="button"
                    className="duration-chip"
                    onClick={() => setDurationOffset(72)}
                  >
                    + 3 Days
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn-create-auction"
                disabled={creatingAuction}
              >
                {creatingAuction ? "Deploying Auction..." : "🚀 Publish Auction to Live Market"}
              </button>
            </form>
          </div>
        )}

        {/* AUCTIONS GRID (Market or My Listings) */}
        {activeTab !== "create" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.3rem", fontWeight: 700, margin: 0 }}>
                {activeTab === "my-listings"
                  ? "My Farm Produce Listings"
                  : "Live Produce Auctions (Active Bids Only)"}
              </h2>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Showing {displayedAuctions.length} auctions
              </span>
            </div>

            {displayedAuctions.length === 0 ? (
              <div className="empty-box">
                <div className="empty-box-icon">🌾</div>
                <h3>
                  {activeTab === "my-listings"
                    ? farmerSubFilter === "concluded"
                      ? "No Concluded Auctions"
                      : "No Listings Found"
                    : "No Live Auctions Right Now"}
                </h3>
                <p>
                  {activeTab === "my-listings"
                    ? "Click '+ Add New Auction' above to list produce for restaurants to bid on!"
                    : "All ended auctions have been cleared from this live market. Check back soon for fresh harvest!"}
                </p>
              </div>
            ) : (
              <div className="auctions-grid">
                {displayedAuctions.map((auction) => {
                  const currentBid = Number(auction.current_highest_bid || 0);
                  const startPrice = Number(auction.starting_price || 0);
                  const minBid = currentBid > 0 ? currentBid + 1 : startPrice;
                  const isFarmerSelf = user?.id === auction.farmer_id;
                  const timeStatus = getAuctionTimeStatus(auction.end_time);

                  return (
                    <div key={auction.id} className="auction-card">
                      <div className="auction-card-header">
                        <div>
                          <h3 className="auction-item-title">{auction.item_name}</h3>
                          <span className="auction-farmer-name">
                            🌾 Farmer: <strong>{auction.farmer_name || `Farmer #${auction.farmer_id}`}</strong>
                          </span>
                        </div>
                        <span
                          className={`auction-status-badge ${
                            timeStatus.isExpired ? "badge-closed" : "badge-open"
                          }`}
                        >
                          {timeStatus.isExpired ? "CONCLUDED" : `LIVE • ${timeStatus.remainingText}`}
                        </span>
                      </div>

                      <div className="auction-specs">
                        <div className="spec-item">
                          <span className="spec-label">Quantity</span>
                          <span className="spec-value">{auction.quantity}</span>
                        </div>
                        <div className="spec-item">
                          <span className="spec-label">Base Price</span>
                          <span className="spec-value">₹{startPrice.toLocaleString()}</span>
                        </div>
                        <div className="spec-item">
                          <span className="spec-label">Closing At</span>
                          <span className="spec-value" style={{ fontSize: "0.82rem" }}>
                            {timeStatus.formattedDate}
                          </span>
                        </div>
                      </div>

                      {/* Highest Bid Display */}
                      <div className="bid-showcase">
                        <div>
                          <span className="bid-showcase-label">
                            {timeStatus.isExpired ? "Winning Final Bid" : "Current Highest Bid"}
                          </span>
                          <div className="bid-amount-highlight">
                            {currentBid > 0 ? `₹${currentBid.toLocaleString()}` : "No Bids Yet"}
                          </div>
                        </div>
                        {currentBid === 0 && (
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            Opens at ₹{startPrice.toLocaleString()}
                          </span>
                        )}
                      </div>

                      {/* Current Highest Bidder Indicator (Visible to Everyone) */}
                      {!timeStatus.isExpired && (
                        <div className="bidder-info-box">
                          <span className="bidder-label">Current Highest Bidder:</span>
                          <span className="bidder-name-highlight">
                            {auction.highest_bidder_name ? (
                              user?.id === auction.highest_bidder_id ? (
                                <span style={{ color: "#34d399", fontWeight: 800 }}>
                                  🏆 You ({auction.highest_bidder_name})
                                </span>
                              ) : (
                                <>🍽️ {auction.highest_bidder_name}</>
                              )
                            ) : (
                              <span style={{ color: "var(--text-muted)", fontWeight: "normal" }}>
                                No bids placed yet
                              </span>
                            )}
                          </span>
                        </div>
                      )}

                      {/* CONCLUDED / SOLD AUCTION DISPLAY ON FARMER'S PAGE */}
                      {user?.role === "FARMER" && isFarmerSelf && timeStatus.isExpired && (
                        <div>
                          {currentBid > 0 && auction.highest_bidder_name ? (
                            <div className="concluded-winner-box">
                              <span className="concluded-title">🏆 Auction Sold & Concluded</span>
                              <span className="concluded-winner-text">
                                Winning Restaurant: 🍽️ {auction.highest_bidder_name}
                              </span>
                              <span style={{ fontSize: "0.82rem", color: "#a7f3d0" }}>
                                Final Price: ₹{currentBid.toLocaleString()} for {auction.quantity}
                              </span>
                            </div>
                          ) : (
                            <div className="concluded-unclaimed-box">
                              Auction ended with no bids placed. (Base: ₹{startPrice.toLocaleString()})
                            </div>
                          )}
                        </div>
                      )}

                      {/* Restaurant Bidding Form (Only on live auctions) */}
                      {user?.role === "RESTAURANT" && !timeStatus.isExpired && !isFarmerSelf && (
                        <div className="bid-action-form">
                          {/* Quick Add Chips */}
                          <div className="quick-bid-chips">
                            <button
                              type="button"
                              className="quick-bid-chip"
                              onClick={() =>
                                setBidInputs((prev) => ({
                                  ...prev,
                                  [auction.id]: minBid.toString(),
                                }))
                              }
                            >
                              Min ₹{minBid.toLocaleString()}
                            </button>
                            <button
                              type="button"
                              className="quick-bid-chip"
                              onClick={() =>
                                setBidInputs((prev) => ({
                                  ...prev,
                                  [auction.id]: (minBid + 50).toString(),
                                }))
                              }
                            >
                              +₹50
                            </button>
                            <button
                              type="button"
                              className="quick-bid-chip"
                              onClick={() =>
                                setBidInputs((prev) => ({
                                  ...prev,
                                  [auction.id]: (minBid + 100).toString(),
                                }))
                              }
                            >
                              +₹100
                            </button>
                            <button
                              type="button"
                              className="quick-bid-chip"
                              onClick={() =>
                                setBidInputs((prev) => ({
                                  ...prev,
                                  [auction.id]: (minBid + 500).toString(),
                                }))
                              }
                            >
                              +₹500
                            </button>
                          </div>

                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            <input
                              type="number"
                              className="bid-input"
                              placeholder={`Enter ₹ (min ${minBid})`}
                              value={bidInputs[auction.id] || ""}
                              onChange={(e) =>
                                setBidInputs({
                                  ...bidInputs,
                                  [auction.id]: e.target.value,
                                })
                              }
                            />
                            <button
                              className="btn-place-bid"
                              onClick={() => handlePlaceBid(auction)}
                            >
                              Submit Bid
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Farmer delete listing button */}
                      {isFarmerSelf && (
                        <button
                          type="button"
                          className="btn-delete-listing"
                          onClick={() => handleDeleteAuction(auction.id)}
                          title="Delete this listing permanently"
                        >
                          🗑️ Delete Listing
                        </button>
                      )}

                      {!user && !timeStatus.isExpired && (
                        <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginTop: "auto", textAlign: "center" }}>
                          Sign in as a Restaurant to place bids
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* AUTHENTICATION SECTION (If not logged in) */}
        {!user && (
          <div className="auth-wrapper">
            <div className="auth-header">
              <h2>Join the Produce Market</h2>
              <p>Connect direct from harvest to kitchen with zero middlemen.</p>
            </div>

            {/* Switch between Sign In and Sign Up */}
            <div className="auth-switch">
              <button
                type="button"
                className={`auth-switch-btn ${authMode === "login" ? "active" : ""}`}
                onClick={() => setAuthMode("login")}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`auth-switch-btn ${authMode === "register" ? "active" : ""}`}
                onClick={() => setAuthMode("register")}
              >
                Create Account (Sign Up)
              </button>
            </div>

            {/* LOGIN FORM */}
            {authMode === "login" ? (
              <form onSubmit={handleLogin}>
                <div className="form-group">
                  <label>Business or User Name</label>
                  <input
                    className="app-input"
                    placeholder="e.g. The Secure Spoon or Rohan bh"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Password</label>
                  <input
                    className="app-input"
                    type="password"
                    placeholder="Enter your password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="btn-submit-auth"
                  disabled={authLoading}
                >
                  {authLoading ? "Signing In..." : "Sign In to Market"}
                </button>
              </form>
            ) : (
              /* REGISTRATION FORM (Sign Up) */
              <form onSubmit={handleRegister}>
                <span className="role-selector-label">I am registering as a:</span>
                <div className="role-selector-grid">
                  <button
                    type="button"
                    className={`role-card-btn ${
                      authRole === "FARMER" ? "selected-farmer" : ""
                    }`}
                    onClick={() => setAuthRole("FARMER")}
                  >
                    <span className="role-card-icon">🌾</span>
                    <span className="role-card-title">Farmer</span>
                    <span className="role-card-desc">Sell harvest at top rates</span>
                  </button>

                  <button
                    type="button"
                    className={`role-card-btn ${
                      authRole === "RESTAURANT" ? "selected-restaurant" : ""
                    }`}
                    onClick={() => setAuthRole("RESTAURANT")}
                  >
                    <span className="role-card-icon">🍽️</span>
                    <span className="role-card-title">Restaurant</span>
                    <span className="role-card-desc">Bid on fresh produce</span>
                  </button>
                </div>

                <div className="form-group">
                  <label>
                    {authRole === "FARMER" ? "Farm or Farmer Name" : "Restaurant Name"}
                  </label>
                  <input
                    className="app-input"
                    placeholder={
                      authRole === "FARMER"
                        ? "e.g. Sunrise Organic Valley"
                        : "e.g. Grand Spice Bistro"
                    }
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Password (min 6 characters)</label>
                  <input
                    className="app-input"
                    type="password"
                    placeholder="Create a strong password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>

                <button
                  type="submit"
                  className="btn-submit-auth"
                  style={{
                    background:
                      authRole === "FARMER"
                        ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                        : "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                    color: authRole === "FARMER" ? "#064e3b" : "#451a03",
                  }}
                  disabled={authLoading}
                >
                  {authLoading
                    ? "Creating Account..."
                    : `Register as ${authRole === "FARMER" ? "Farmer 🌾" : "Restaurant 🍽️"}`}
                </button>
              </form>
            )}

            {/* Quick Demo Credentials Helper */}
            <div className="demo-accounts-bar">
              <p>Quick Demo Test Accounts (Click to Fill):</p>
              <div className="demo-chips">
                <button
                  type="button"
                  className="demo-chip"
                  onClick={() => {
                    setAuthMode("login");
                    setAuthName("Rohan bhandari");
                    setAuthPassword("supersecretpassword");
                  }}
                >
                  🌾 Rohan bhandari (Farmer)
                </button>
                <button
                  type="button"
                  className="demo-chip"
                  onClick={() => {
                    setAuthMode("login");
                    setAuthName("The Secure Spoon");
                    setAuthPassword("supersecretpassword");
                  }}
                >
                  🍽️ The Secure Spoon (Restaurant)
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Real-time Toasts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-msg ${
              t.type === "success"
                ? "toast-success"
                : t.type === "error"
                ? "toast-error"
                : "toast-info"
            }`}
          >
            <span>{t.type === "success" ? "✓" : t.type === "error" ? "⚠️" : "⚡"}</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
