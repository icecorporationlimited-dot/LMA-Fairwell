import express from "express";
import crypto from "crypto";
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

let mongoClient;

async function db() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri === "xyz") throw new Error("MONGODB_URI is not configured.");
  if (!mongoClient) {
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
  }
  return mongoClient.db("lma_farewell");
}

function jsonError(res, err, status = 500) {
  console.error(err);
  res.status(status).json({ error: err?.message || "Server error" });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, key] = String(stored || "").split(":");
  if (!salt || !key) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(key, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signToken(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  const data = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function getAuth(req) {
  const raw = req.headers.authorization || "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7) : "";
  const [data, sig] = token.split(".");
  if (!data || !sig || !process.env.SESSION_SECRET) throw new Error("Unauthorized");

  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET)
    .update(data).digest("base64url");

  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("Unauthorized");
  }

  const payload = JSON.parse(Buffer.from(data, "base64url").toString());
  if (!payload.exp || payload.exp < Date.now()) throw new Error("Session expired");
  return payload;
}

function requireAuth(req, res, role = null) {
  try {
    const user = getAuth(req);
    if (role && user.role !== role) {
      res.status(403).json({ error: "Access denied." });
      return null;
    }
    return user;
  } catch {
    res.status(401).json({ error: "Unauthorized." });
    return null;
  }
}

async function ensureIndexes(database) {
  await database.collection("users").createIndex({ email: 1 }, { unique: true });
  await database.collection("applications").createIndex({ userId: 1 });
  await database.collection("passes").createIndex({ applicationId: 1 }, { unique: true });
}

/* ---------------- AUTH ---------------- */

app.get("/api/auth", async (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;

  try {
    const database = await db();
    const user = await database.collection("users").findOne(
      { _id: new ObjectId(me.userId) },
      { projection: { passwordHash: 0 } }
    );
    if (!user) return res.status(404).json({ error: "User not found." });

    res.json({
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (e) {
    jsonError(res, e);
  }
});

app.post("/api/auth", async (req, res) => {
  try {
    const database = await db();
    await ensureIndexes(database);

    const users = database.collection("users");
    const { action, name, email: rawEmail, password } = req.body || {};
    const email = String(rawEmail || "").trim().toLowerCase();

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    if (action === "register") {
      if (!name || String(password).length < 8) {
        return res.status(400).json({
          error: "Name and an 8+ character password are required."
        });
      }

      if (await users.findOne({ email })) {
        return res.status(409).json({
          error: "An account with this email already exists."
        });
      }

      const result = await users.insertOne({
        name: String(name).trim(),
        email,
        passwordHash: hashPassword(String(password)),
        role: "student",
        createdAt: new Date()
      });

      const token = signToken({
        userId: result.insertedId.toString(),
        role: "student"
      });

      return res.status(201).json({
        token,
        user: { name: String(name).trim(), email, role: "student" }
      });
    }

    if (action === "login") {
      const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
      const adminPassword = process.env.ADMIN_PASSWORD || "";

      if (email === adminEmail && String(password) === adminPassword) {
        let user = await users.findOne({ email });

        if (!user) {
          const result = await users.insertOne({
            name: "Farewell Admin",
            email,
            passwordHash: hashPassword(String(password)),
            role: "admin",
            createdAt: new Date()
          });
          user = {
            _id: result.insertedId,
            name: "Farewell Admin",
            email,
            role: "admin"
          };
        } else if (user.role !== "admin") {
          await users.updateOne(
            { _id: user._id },
            { $set: { role: "admin" } }
          );
          user.role = "admin";
        }

        return res.json({
          token: signToken({
            userId: user._id.toString(),
            role: "admin"
          }),
          user: {
            name: user.name,
            email: user.email,
            role: "admin"
          }
        });
      }

      const user = await users.findOne({ email });
      if (!user || !verifyPassword(String(password), user.passwordHash)) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      return res.json({
        token: signToken({
          userId: user._id.toString(),
          role: user.role
        }),
        user: {
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    }

    res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    jsonError(res, e);
  }
});

/* ---------------- STUDENT APPLICATION ---------------- */

app.get("/api/application", async (req, res) => {
  const me = requireAuth(req, res, "student");
  if (!me) return;

  try {
    const database = await db();
    const userId = new ObjectId(me.userId);

    const application = await database.collection("applications")
      .findOne({ userId }, { sort: { createdAt: -1 } });

    const pass = application?.status === "approved"
      ? await database.collection("passes").findOne({
          applicationId: application._id
        })
      : null;

    res.json({ application, pass });
  } catch (e) {
    jsonError(res, e);
  }
});

app.post("/api/application", async (req, res) => {
  const me = requireAuth(req, res, "student");
  if (!me) return;

  try {
    const database = await db();
    const applications = database.collection("applications");
    const users = database.collection("users");
    const userId = new ObjectId(me.userId);

    const b = req.body || {};
    for (const field of ["studentName", "className", "section", "rollNumber"]) {
      if (!String(b[field] || "").trim()) {
        return res.status(400).json({
          error: "Please fill all required details."
        });
      }
    }

    const guestCount = Number(b.guestCount ?? 0);
    if (!Number.isInteger(guestCount) || guestCount < 0 || guestCount > 5) {
      return res.status(400).json({
        error: "Guest count must be between 0 and 5."
      });
    }

    const user = await users.findOne({ _id: userId });

    const doc = {
      userId,
      userEmail: user.email,
      studentName: String(b.studentName).trim(),
      className: String(b.className).trim(),
      section: String(b.section).trim(),
      rollNumber: String(b.rollNumber).trim(),
      studentId: String(b.studentId || "").trim(),
      phone: String(b.phone || "").trim(),
      guestCount,
      photoUrl: String(b.photoUrl || "").trim(),
      note: String(b.note || "").trim(),
      status: "pending",
      rejectionReason: "",
      updatedAt: new Date()
    };

    const old = await applications.findOne({ userId });

    if (old) {
      // Once approved, editing the application puts it back into review.
      await applications.updateOne(
        { _id: old._id },
        { $set: { ...doc, createdAt: old.createdAt } }
      );

      await database.collection("passes").deleteMany({
        applicationId: old._id
      });

      return res.json({
        application: await applications.findOne({ _id: old._id })
      });
    }

    const result = await applications.insertOne({
      ...doc,
      createdAt: new Date()
    });

    res.status(201).json({
      application: await applications.findOne({ _id: result.insertedId })
    });
  } catch (e) {
    jsonError(res, e);
  }
});

/* ---------------- ADMIN ---------------- */

app.get("/api/admin", async (req, res) => {
  const me = requireAuth(req, res, "admin");
  if (!me) return;

  try {
    const database = await db();
    const list = await database.collection("applications")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const stats = {
      total: list.length,
      pending: list.filter(x => x.status === "pending").length,
      approved: list.filter(x => x.status === "approved").length,
      rejected: list.filter(x => x.status === "rejected").length
    };

    res.json({ applications: list, stats });
  } catch (e) {
    jsonError(res, e);
  }
});

app.post("/api/admin", async (req, res) => {
  const me = requireAuth(req, res, "admin");
  if (!me) return;

  try {
    const database = await db();
    const applications = database.collection("applications");
    const passes = database.collection("passes");

    const { action, applicationId, reason } = req.body || {};

    if (!ObjectId.isValid(applicationId)) {
      return res.status(400).json({ error: "Invalid application ID." });
    }

    const id = new ObjectId(applicationId);
    const application = await applications.findOne({ _id: id });

    if (!application) {
      return res.status(404).json({ error: "Application not found." });
    }

    if (action === "approve") {
      const existing = await passes.findOne({ applicationId: id });
      const passId = existing?.passId ||
        `LMA-26-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

      await applications.updateOne(
        { _id: id },
        {
          $set: {
            status: "approved",
            rejectionReason: "",
            updatedAt: new Date()
          }
        }
      );

      await passes.updateOne(
        { applicationId: id },
        {
          $set: {
            applicationId: id,
            userId: application.userId,
            studentName: application.studentName,
            className: application.className,
            section: application.section,
            rollNumber: application.rollNumber,
            guestCount: application.guestCount,
            passId,
            status: "active",
            updatedAt: new Date()
          },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
      );

      return res.json({ ok: true, passId });
    }

    if (action === "reject") {
      await applications.updateOne(
        { _id: id },
        {
          $set: {
            status: "rejected",
            rejectionReason: String(reason || "Please contact the school office."),
            updatedAt: new Date()
          }
        }
      );

      await passes.deleteMany({ applicationId: id });

      return res.json({ ok: true });
    }

    res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    jsonError(res, e);
  }
});

/* Health check */
app.get("/health", async (_req, res) => {
  res.json({ ok: true, service: "LMA Farewell Portal" });
});

/* SPA fallback */
app.get("*", (_req, res) => {
  res.sendFile("index.html", { root: "public" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`LMA Farewell Portal running on port ${PORT}`);
});
