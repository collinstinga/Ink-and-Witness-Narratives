import express, { Request, Response, NextFunction } from "express";
import http from "http";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { store } from "./src/server/store.js";
import { Article, PaymentTransaction, User } from "./src/types.js";
import { fetchLiveExchangeRates, convertToKes, SUPPORTED_CURRENCIES } from "./src/server/exchangeRates.js";
import { hashAffiliatePassword, verifyAffiliatePassword } from "./src/server/affiliateStore.js";
import { verifyPassword, hashPassword, validatePasswordStrength } from "./src/server/auth.js";
import {
  initiateStkPush,
  handleDarajaCallback,
  queryPaymentStatus,
  verifyManualReceipt,
  getDarajaAccessToken,
  formatKenyanPhone,
  maskPhone
} from "./src/server/mpesa.js";

dotenv.config();

// Initialize the persistent store once per runtime instance.
let storeInitPromise: Promise<void> | null = null;
function ensureStoreInitialized(): Promise<void> {
  if (!storeInitPromise) {
    storeInitPromise = store.init().catch(err => {
      storeInitPromise = null;
      console.error("Store init error:", err);
      throw err;
    });
  }
  return storeInitPromise;
}

const SESSION_COOKIE_NAME = 'iw_session';
const isProduction = process.env.NODE_ENV === 'production';

// Cookie helpers
function setSessionCookie(res: Response, sessionId: string, maxAgeMs: number = 7 * 24 * 60 * 60 * 1000) {
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: maxAgeMs,
    path: '/'
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/'
  });
}

// Session resolution middleware
async function loadSessionUser(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionId = (req as any).cookies?.[SESSION_COOKIE_NAME];
    if (sessionId) {
      const session = await store.getAuthSession(sessionId);
      if (session && session.expiresAt > Date.now()) {
        (req as any).user = {
          id: session.userId,
          email: session.email,
          role: session.role,
          name: session.name,
          sessionId: session.sessionId
        };
        return next();
      } else if (session) {
        await store.invalidateAuthSession(sessionId);
        clearSessionCookie(res);
      }
    }

    // Check bearer/x-admin-token only for a valid server-created session
    const authHeader = req.headers.authorization;
    const adminTokenHeader = req.headers['x-admin-token'] as string;
    let token = adminTokenHeader;
    if (!token && authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    if (token) {
      const session = await store.getAuthSession(token);
      if (session && session.expiresAt > Date.now()) {
        (req as any).user = {
          id: session.userId,
          email: session.email,
          role: session.role,
          name: session.name,
          sessionId: session.sessionId
        };
        return next();
      }

    }

    (req as any).user = null;
    next();
  } catch (err) {
    (req as any).user = null;
    next();
  }
}

// Authentication middleware for general users (clients or admins)
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ success: false, error: "Authentication required. Please sign in." });
  }
  next();
}

// Authentication middleware for Writer Studio Admin (Strict server-side role verification)
function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;

  if (user && user.role === 'admin') {
    return next();
  }

  if (user && user.role === 'client') {
    return res.status(403).json({ success: false, error: "Forbidden. Administrator privileges required." });
  }

  return res.status(401).json({ success: false, error: "Unauthorized. Administrator authentication required." });
}

// Authentication middleware for Affiliate Portal (Strictly isolated from Writer Portal)
function requireAffiliateAuth(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Content-Type', 'application/json');
  const authHeader = req.headers.authorization;
  const affTokenHeader = req.headers['x-affiliate-token'] as string;
  
  let token = affTokenHeader;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Authentication required. Please log in to access the affiliate portal.",
      code: "AUTH_REQUIRED"
    });
  }

  const affiliate = store.affiliates.verifyAffiliateSession(token);
  if (!affiliate) {
    return res.status(401).json({
      success: false,
      error: "Affiliate session expired or invalid. Please log in again.",
      code: "SESSION_EXPIRED"
    });
  }

  (req as any).affiliate = affiliate;
  return next();
}

// Lazy Gemini SDK initialization
let genAIClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!genAIClient && process.env.GEMINI_API_KEY) {
    try {
      genAIClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } catch (err) {
      console.warn("Failed to initialize Gemini SDK:", err);
    }
  }
  return genAIClient;
}

// Helpers
function generateToken(): string {
  return "ink_" + crypto.randomBytes(16).toString('hex');
}

export async function createApp() {
  await ensureStoreInitialized();
  const app = express();

  // Trust Cloud Run / reverse proxy for accurate client IP resolution & rate limiting
  app.set("trust proxy", 1);

  // Security Headers & Content Security Policy
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
        connectSrc: ["'self'", "https:", "wss:", "ws:"],
        frameAncestors: ["*"]
      }
    },
    crossOriginEmbedderPolicy: false
  }));

  app.use(cookieParser());
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));
  app.use(loadSessionUser);

  // Rate limiters for security
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, default: false },
    message: { success: false, error: "Too many login attempts. Please try again after 15 minutes." }
  });

  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, default: false },
    message: { success: false, error: "Too many account registrations from this IP. Please try again later." }
  });

  const stkPushLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, default: false },
    message: { success: false, error: "Payment request limit reached. Please wait a few minutes before requesting another M-Pesa prompt." }
  });

  const bankOrderLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, default: false },
    message: { success: false, error: "Too many payment orders created. Please try again shortly." }
  });

  const verifyAccessLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, default: false },
    message: { valid: false, message: "Too many access verification requests. Please try again in a moment." }
  });

  const paymentStatusLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 150,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, default: false },
    message: { error: "Polling rate limit exceeded. Please wait a moment." }
  });

  // Prevent every page view from re-running the same Firestore-heavy public
  // reads. Authenticated and token-bearing requests are never shared-cached.
  const cacheablePublicPaths = new Set([
    '/api/health', '/api/author', '/api/articles', '/api/categories',
    '/api/topics', '/api/homepage'
  ]);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const hasCredentials = Boolean(
      req.headers.authorization || req.headers.cookie ||
      req.headers['x-session-token'] || req.headers['x-access-token']
    );
    if (req.method === 'GET' && cacheablePublicPaths.has(req.path) && !hasCredentials) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    }
    next();
  });

  const servePersistentAsset = async (req: Request, res: Response) => {
    try {
      const rawId = req.params.assetId || req.params.filename;
      const assetId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const asset = await store.getUploadedAsset(assetId);
      if (!asset?.dataUrl) return res.status(404).json({ error: 'Image not found.' });

      const match = asset.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return res.status(500).json({ error: 'Stored image is invalid.' });
      const image = Buffer.from(match[2], 'base64');
      res.setHeader('Content-Type', asset.mimeType || match[1] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(image);
    } catch (err) {
      console.error('[Assets] Failed to serve persistent image:', err);
      return res.status(503).json({ error: 'Image storage is temporarily unavailable.' });
    }
  };

  app.get('/api/assets/:assetId', servePersistentAsset);
  // Backward-compatible path for image URLs saved before cloud serving.
  app.get('/uploads/:filename', servePersistentAsset);
  // Local-development fallback for files not yet migrated into Firestore.
  app.use('/uploads', express.static(path.join(process.cwd(), 'data', 'uploads')));

  // ==========================================
  // PUBLIC API ROUTES
  // ==========================================

  // Health check
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      appName: "Ink & Witness",
      time: new Date().toISOString(),
      articlesCount: store.getArticles(false).length,
      hasGemini: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Public Author Profile
  app.get("/api/author", (_req: Request, res: Response) => {
    res.json(store.getAuthorProfile());
  });

  // Public Homepage Configuration & Curated Sections
  app.get("/api/homepage", (_req: Request, res: Response) => {
    res.json(store.getHomepageConfig());
  });

  // Public Custom Categories (Dynamically managed by writer Jake)
  app.get("/api/categories", (_req: Request, res: Response) => {
    try {
      const categories = store.getCategories();
      res.json(categories);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch categories" });
    }
  });

  // Public Topics Catalogue (Dynamically managed by writer Jake)
  app.get("/api/topics", (req: Request, res: Response) => {
    try {
      const isAdmin = (req as any).user?.role === 'admin';
      const includeHidden = req.query.includeHidden === 'true' && isAdmin;
      // Only include topics with published pieces for public readers; admin gets all
      const topics = store.getTopics(includeHidden, !isAdmin);
      res.json(topics);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch topics" });
    }
  });

  // Public Topic details with assigned published pieces
  app.get("/api/topics/:idOrSlug", (req: Request, res: Response) => {
    try {
      const { idOrSlug } = req.params;
      const topic = store.getTopicById(idOrSlug);
      if (!topic) {
        return res.status(404).json({ error: "Topic not found" });
      }

      const isAdmin = (req as any).user?.role === 'admin';
      const allArticles = store.getArticles(isAdmin);
      
      const pieceIds = topic.pieceIds || [];
      const assignedPieces = allArticles.filter(art => 
        (isAdmin || art.status === 'published' || !art.status) &&
        (
          pieceIds.includes(art.id) || 
          (art.topics && (art.topics.includes(topic.slug) || art.topics.includes(topic.name) || art.topics.includes(topic.id)))
        )
      );

      res.json({
        topic,
        pieces: assignedPieces
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch topic details" });
    }
  });

  // Public Articles List (DRAFTS ARE STRICTLY EXCLUDED)
  app.get("/api/articles", (req: Request, res: Response) => {
    const isAdmin = (req as any).user?.role === 'admin';

    // If admin requested via public endpoint, can include drafts, but standard readers only get published
    const list = store.getArticles(isAdmin);
    const mpesaSettings = store.getMpesaSettings();

    const publicArticles = list.map(art => {
      const isPaid = art.isPaid !== false && (art.priceKes > 0);
      return {
        id: art.id,
        title: art.title,
        subtitle: art.subtitle,
        slug: art.slug,
        category: art.category,
        categories: art.categories || (art.category ? [art.category] : []),
        status: art.status,
        isPaid,
        priceKes: art.priceKes || mpesaSettings.defaultPriceKes,
        readTimeMinutes: art.readTimeMinutes,
        publishedAt: art.publishedAt,
        createdAt: art.createdAt,
        updatedAt: art.updatedAt,
        coverImage: art.coverImage,
        featured: art.featured,
        downloadsCount: art.downloadsCount || 0,
        viewsCount: art.viewsCount || 0,
        previewParagraphs: art.previewParagraphs || [],
        tags: art.tags || [],
        excerpt: art.excerpt,
        synopsis: art.synopsis || "",
        // If article is free OR reader is authenticated admin, send content; otherwise mask
        content: (!isPaid || isAdmin) ? art.content : "",
        isUnlocked: !isPaid || isAdmin,
      };
    });

    res.json(publicArticles);
  });

  // Public Get Single Article (with server-side paywall & draft protection)
  app.get("/api/articles/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const isAdmin = (req as any).user?.role === 'admin';

    const article = store.getArticleById(id, isAdmin);
    if (!article) {
      return res.status(404).json({ error: "Piece not found or private draft." });
    }

    const token = (req.headers['x-download-token'] || req.headers['x-reader-token'] || req.query.token) as string;
    const isPaid = article.isPaid !== false && (article.priceKes > 0);
    let isUnlocked = !isPaid || isAdmin;

    if (!isUnlocked && token) {
      const tokenData = store.getPurchasedToken(token);
      if (tokenData && tokenData.expiresAt > Date.now()) {
        if (tokenData.articleId === article.id || tokenData.articleId === 'all') {
          isUnlocked = true;
        }
      }
    }

    // Check if authenticated reader owns this piece
    const user = (req as any).user;
    if (!isUnlocked && user) {
      if (store.isArticlePurchasedByUser(article.id, user)) {
        isUnlocked = true;
      }
    }

    return res.json({
      ...article,
      content: isUnlocked ? article.content : "",
      isUnlocked,
      priceKes: article.priceKes || store.getMpesaSettings().defaultPriceKes,
    });
  });

  // Public M-Pesa Configuration (Safe client settings for checkout UI)
  app.get("/api/mpesa/config", (_req: Request, res: Response) => {
    const mpesaSettings = store.getMpesaSettings();
    res.json({
      paymentType: mpesaSettings.paymentType,
      shortcode: mpesaSettings.shortcode,
      tillNumber: mpesaSettings.tillNumber || "1618656",
      tillName: mpesaSettings.tillName || "Ink & Witness / Jake",
      storeNumber: mpesaSettings.storeNumber || "1145520",
      paybillNumber: mpesaSettings.paybillNumber,
      accountReference: mpesaSettings.accountReference,
      businessPhone: mpesaSettings.businessPhone || "0715601209",
      whatsappNumber: mpesaSettings.whatsappNumber || "0715601209",
      callPhoneNumber: mpesaSettings.callPhoneNumber || "0715601209",
      env: mpesaSettings.env,
      defaultPriceKes: mpesaSettings.defaultPriceKes || 1050,
      tippingEnabled: mpesaSettings.tippingEnabled !== false,
      minTipKes: mpesaSettings.minTipKes || 300,
      hasConsumerKey: Boolean(mpesaSettings.consumerKey),
      hasConsumerSecret: Boolean(mpesaSettings.consumerSecret),
      hasPasskey: Boolean(mpesaSettings.passkey),
    });
  });

  // Live Currency Exchange Rates & Supported Currencies Endpoint
  app.get("/api/exchange-rates", async (req: Request, res: Response) => {
    try {
      const forceRefresh = req.query.refresh === "true";
      const ratesData = await fetchLiveExchangeRates(forceRefresh);
      const mpesaSettings = store.getMpesaSettings();
      res.json({
        ...ratesData,
        supportedCurrencies: SUPPORTED_CURRENCIES,
        minTipKes: mpesaSettings.minTipKes || 300,
        tippingEnabled: mpesaSettings.tippingEnabled !== false,
      });
    } catch (err: any) {
      console.error("Exchange rates fetch error:", err);
      res.status(500).json({ error: "Failed to fetch exchange rates" });
    }
  });

  // Restore Monograph Access via Genuine Confirmed Safaricom Receipt
  app.post("/api/mpesa/restore-purchase", async (req: Request, res: Response) => {
    try {
      const { transactionCode, phoneNumber } = req.body;

      if (!transactionCode) {
        return res.status(400).json({ error: "Safaricom M-Pesa receipt number is required." });
      }

      const cleanCode = transactionCode.trim().toUpperCase();
      
      // Look up genuine transactions in database (confirmed or matching pending)
      let existingTx = store.getTransactions().find(t => 
        (
          (t.mpesaReceiptNumber && t.mpesaReceiptNumber.toUpperCase() === cleanCode) ||
          (t.checkoutRequestId && t.checkoutRequestId.toUpperCase() === cleanCode) ||
          (t.receiptNumber && t.receiptNumber.toUpperCase() === cleanCode)
        )
      );

      if (!existingTx) {
        existingTx = store.getTransaction(cleanCode);
      }

      // If matching pending transaction, confirm it with the receipt
      if (existingTx && existingTx.status === 'PENDING') {
        store.confirmTransaction(existingTx.checkoutRequestId, cleanCode);
        existingTx = store.getTransaction(existingTx.checkoutRequestId) || existingTx;
      }

      if (!existingTx || (existingTx.status !== "SUCCESS" && existingTx.status !== "CONFIRMED" && existingTx.status !== "PAID")) {
        return res.status(404).json({ 
          error: "No verified Safaricom payment found for this receipt. Please ensure your payment has completed on your phone." 
        });
      }

      const article = existingTx.articleId ? store.getArticleById(existingTx.articleId, true) : null;
      if (!article) {
        return res.status(404).json({ error: "Article associated with this transaction was not found." });
      }

      const downloadToken = existingTx.downloadToken || generateToken();
      if (!existingTx.downloadToken) {
        existingTx.downloadToken = downloadToken;
        await store.saveTransaction(existingTx);
      }

      // Ensure access token is saved in token store
      await store.savePurchasedToken(downloadToken, {
        articleId: article.id,
        phone: phoneNumber ? formatKenyanPhone(phoneNumber) : (existingTx.phoneNumber || "254705275647"),
        expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
        receipt: cleanCode,
        createdAt: new Date().toISOString()
      });

      res.json({
        success: true,
        status: "SUCCESS",
        receipt: existingTx.mpesaReceiptNumber || cleanCode,
        downloadToken,
        articleId: article.id,
        articleTitle: article.title,
        message: `Verified Safaricom payment ${cleanCode}. Full monograph unlocked.`,
      });
    } catch (err: any) {
      console.error("Restore purchase error:", err);
      res.status(500).json({ error: err.message || "Failed to restore purchase." });
    }
  });

  // Affiliate / Referral Redirect Tracking Route
  app.get("/r/:code", (req: Request, res: Response) => {
    try {
      const code = (req.params.code || "").trim();
      const articleId = (req.query.article || req.query.articleId || req.query.id || req.query.monograph || "") as string;
      const campaignCode = (req.query.c || req.query.campaign || "") as string;

      // Extract client details for click tracking
      const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "").split(",")[0].trim();
      const userAgent = (req.headers["user-agent"] as string || "").substring(0, 150);
      const referrer = (req.headers["referer"] || req.headers["referrer"] || "") as string;
      const ipHash = crypto.createHash("sha256").update(ip + userAgent).digest("hex").substring(0, 16);

      // Validate affiliate code
      const aff = store.affiliates.getAffiliateByCode(code);

      if (aff && aff.status === "active" && !aff.linksDisabled) {
        // Record server-side click event and update stats
        store.affiliates.registerClick(
          aff.affiliateCode,
          articleId || undefined,
          campaignCode || undefined,
          ipHash,
          userAgent,
          referrer
        );

        // Build target redirect URL preserving ref, article, and campaign query parameters
        const params = new URLSearchParams();
        params.set("ref", aff.affiliateCode);
        if (articleId) {
          params.set("article", articleId);
        }
        if (campaignCode) {
          params.set("c", campaignCode);
        }

        return res.redirect(302, `/?${params.toString()}`);
      }

      // If affiliate is invalid, suspended, or links are disabled, gracefully redirect reader to piece or home
      const fallbackParams = new URLSearchParams();
      if (articleId) {
        fallbackParams.set("article", articleId);
      }
      const qs = fallbackParams.toString();
      return res.redirect(302, `/${qs ? `?${qs}` : ""}`);
    } catch (err) {
      console.warn("[Affiliate Link Route] Error during redirect:", err);
      return res.redirect(302, "/");
    }
  });

  // Verify Download Token for reader access
  app.get("/api/verify-access", verifyAccessLimiter, (req: Request, res: Response) => {
    const token = req.query.token as string;
    const articleId = req.query.articleId as string;

    if (!token) {
      return res.status(401).json({ valid: false, message: "No access token provided." });
    }

    const tokenData = store.getPurchasedToken(token);
    if (!tokenData) {
      return res.status(401).json({ valid: false, message: "Invalid or expired access token." });
    }

    if (tokenData.expiresAt < Date.now()) {
      return res.status(401).json({ valid: false, message: "Access token has expired." });
    }

    if (articleId && tokenData.articleId !== articleId && tokenData.articleId !== 'all') {
      return res.status(403).json({ valid: false, message: "Token is not valid for this specific piece." });
    }

    const article = store.getArticleById(articleId || tokenData.articleId, true);
    res.json({
      valid: true,
      article,
      receipt: tokenData.receipt,
      expiresAt: new Date(tokenData.expiresAt).toISOString(),
    });
  });

  // Manual Access / Self-Unlock verification for Readers with One-Time Activation & Account Binding
  app.post("/api/manual-access/verify", verifyAccessLimiter, (req: Request, res: Response) => {
    try {
      const { articleId, phone } = req.body;
      const currentUser = (req as any).user || null;
      if (!articleId || !phone) {
        return res.status(400).json({ 
          success: false, 
          verified: false, 
          error: "Piece ID and phone number are required." 
        });
      }

      const result = store.verifyManualAccess(articleId, phone, currentUser);

      if (result.success && result.verified) {
        return res.json({
          success: true,
          verified: true,
          activated: Boolean(result.activated),
          token: result.token,
          articleId: result.articleId,
          articleTitle: result.articleTitle,
          boundUser: result.boundUser,
          grant: result.grant,
          message: result.message
        });
      } else {
        return res.status(404).json({
          success: false,
          verified: false,
          error: result.error || result.message,
          message: result.message
        });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, verified: false, error: err.message || "Manual access verification failed." });
    }
  });

  // ==========================================
  // AUTHORITATIVE M-PESA DARAJA PRODUCTION FLOW
  // ==========================================

  // Initiate M-Pesa STK Push
  app.post("/api/mpesa/stkpush", stkPushLimiter, async (req: Request, res: Response) => {
    try {
      const { 
        articleId, 
        phoneNumber, 
        phone,
        tel,
        msisdn,
        phone_number,
        senderPhone,
        amount, 
        isTip,
        currency,
        originalAmount,
        exchangeRate,
        exchangeRateTimestamp,
        affiliateCode,
        campaignCode
      } = req.body || {};

      const rawPhone = phoneNumber || phone || tel || msisdn || phone_number || senderPhone;
      if (!rawPhone) {
        return res.status(400).json({ error: "Phone number is required for M-Pesa STK Push." });
      }

      const mpesaSettings = store.getMpesaSettings();

      if (isTip && mpesaSettings.tippingEnabled === false) {
        return res.status(403).json({ error: "Tipping is currently disabled by the author." });
      }

      let articleTitle = "Ink & Witness Reader Access";
      let chargeAmount = Number(amount) || 300;
      const type = isTip ? "TIP" : "PURCHASE";

      if (articleId && articleId !== "general_tip" && articleId !== "test_stk") {
        const article = store.getArticleById(articleId, true);
        if (article) {
          articleTitle = article.title;
          if (!isTip) {
            // Server enforces price for pay-to-read
            chargeAmount = article.priceKes || mpesaSettings.defaultPriceKes || 300;
          }
        }
      }

      if (isTip) {
        // Enforce server-side minimum tip (default 300 KES)
        const minTip = mpesaSettings.minTipKes || 300;
        chargeAmount = Math.max(minTip, Math.round(Number(amount) || minTip));
        if (!articleTitle || articleTitle === "Ink & Witness Reader Access") {
          articleTitle = "Ink & Witness Author Tip";
        }
      }

      const formattedPhone = formatKenyanPhone(rawPhone);

      const stkResult = await initiateStkPush({
        phoneNumber: formattedPhone,
        amount: chargeAmount,
        accountReference: articleTitle,
        articleId: articleId || (isTip ? "general_tip" : "custom"),
        articleTitle,
        type,
        currency: currency || "KES",
        originalAmount: originalAmount ? Number(originalAmount) : chargeAmount,
        exchangeRate: exchangeRate ? Number(exchangeRate) : (currency === "KES" || !currency ? 1 : undefined),
        exchangeRateTimestamp: exchangeRateTimestamp || new Date().toISOString(),
        affiliateCode: affiliateCode || undefined,
        campaignCode: campaignCode || undefined,
        userId: (req as any).user?.id,
        userEmail: (req as any).user?.email,
      });

      if (!stkResult.success || !stkResult.checkoutRequestId) {
        return res.status(400).json({
          success: false,
          error: stkResult.error || "Failed to dispatch STK Push to Safaricom Daraja."
        });
      }

      res.json({
        success: true,
        message: stkResult.message,
        checkoutRequestId: stkResult.checkoutRequestId,
        merchantRequestId: stkResult.merchantRequestId,
        articleTitle,
        amount: chargeAmount,
        currency: currency || "KES",
        originalAmount: originalAmount ? Number(originalAmount) : chargeAmount,
        phoneNumber: formattedPhone,
        live: true
      });
    } catch (err: any) {
      console.error("STK Push controller exception:", err);
      res.status(500).json({ error: err.message || "Failed to initiate M-Pesa payment" });
    }
  });

  // Bank Payment Order Creation (Direct Bank / RTGS / EFT / Paybill Bank Transfer)
  app.post("/api/payments/bank-order", bankOrderLimiter, async (req: Request, res: Response) => {
    try {
      const { 
        articleId, 
        customerName, 
        email, 
        phoneNumber, 
        currency, 
        amount,
        affiliateCode,
        campaignCode
      } = req.body;
      const mpesaSettings = store.getMpesaSettings();

      let articleTitle = "Ink & Witness Monograph Access";
      let chargeAmount = Number(amount) || mpesaSettings.defaultPriceKes || 300;

      if (articleId && articleId !== "general_tip") {
        const article = store.getArticleById(articleId, true);
        if (article) {
          articleTitle = article.title;
          chargeAmount = article.priceKes || mpesaSettings.defaultPriceKes || 300;
        }
      }

      const randomSuffix = Math.floor(100000 + Math.random() * 900000).toString();
      const bankRef = `BW-${randomSuffix}`;
      const checkoutRequestId = `bank_${Date.now()}_${randomSuffix}`;

      const tx: PaymentTransaction = {
        id: `tx_bank_${Date.now()}`,
        checkoutRequestId,
        articleId: articleId || "custom",
        articleTitle,
        phoneNumber: phoneNumber ? maskPhone(phoneNumber) : undefined,
        amount: chargeAmount,
        currency: currency || "KES",
        originalAmount: chargeAmount,
        exchangeRate: 1,
        paymentMethod: "bank",
        type: "PURCHASE",
        status: "PENDING",
        bankReference: bankRef,
        bankAccountRef: `NCBA Bank Kenya | Acc: 729104819 | Till: ${mpesaSettings.tillNumber || '1618656'}`,
        createdAt: new Date().toISOString(),
        affiliateCode: affiliateCode || undefined,
        campaignCode: campaignCode || undefined,
      };

      await store.saveTransaction(tx);

      if (affiliateCode) {
        console.log(`[Attributed Checkout Initiated] Method: Bank Order, Tx ID: ${tx.id}, BankRef: ${bankRef}, Affiliate: ${affiliateCode}, Campaign: ${campaignCode || 'none'}, Amount: KES ${chargeAmount}`);
      }

      res.json({
        success: true,
        checkoutRequestId,
        bankReference: bankRef,
        bankDetails: {
          bankName: "NCBA Bank Kenya / Absa Kenya",
          accountName: "Ink & Witness Narratives / Jake",
          accountNumber: "72910481920",
          branch: "Westlands, Nairobi",
          paybillAlternative: "Paybill 888880, Acc: 72910481920",
          tillAlternative: `Buy Goods Till ${mpesaSettings.tillNumber || '1618656'}`,
          referenceToInclude: bankRef,
          amountKes: chargeAmount,
        },
        message: `Bank payment order created with reference ${bankRef}. Transfer KES ${chargeAmount} and submit your bank confirmation reference to unlock.`
      });
    } catch (err: any) {
      console.error("Bank order error:", err);
      res.status(500).json({ error: err.message || "Failed to create bank order" });
    }
  });

  // Bank Payment Submit Customer Bank Transaction Reference
  app.post("/api/payments/bank-submit-ref", async (req: Request, res: Response) => {
    try {
      const { checkoutRequestId, customerRef, senderPhone } = req.body;
      if (!checkoutRequestId || !customerRef) {
        return res.status(400).json({ error: "Order ID and Bank Transaction Reference are required." });
      }

      const tx = store.getTransaction(checkoutRequestId);
      if (!tx) {
        return res.status(404).json({ error: "Order not found." });
      }

      tx.bankReference = customerRef.trim().toUpperCase();
      if (senderPhone) {
        tx.phoneNumber = maskPhone(senderPhone);
      }
      tx.updatedAt = new Date().toISOString();
      await store.saveTransaction(tx);

      res.json({
        success: true,
        status: tx.status,
        message: `Bank reference ${tx.bankReference} submitted. Our automated ledger and author desk will reconcile the payment.`,
        transaction: tx
      });
    } catch (err: any) {
      console.error("Bank ref submit error:", err);
      res.status(500).json({ error: err.message || "Failed to submit bank reference" });
    }
  });

  // Query transaction status (Universal: M-Pesa or Bank)
  app.get(["/api/mpesa/query/:checkoutRequestId", "/api/mpesa/status/:checkoutRequestId"], paymentStatusLimiter, async (req: Request, res: Response) => {
    const { checkoutRequestId } = req.params;
    const result = await queryPaymentStatus(checkoutRequestId);
    
    if (!result) {
      return res.status(404).json({ error: "Transaction not found." });
    }

    const tx = store.getTransaction(checkoutRequestId);
    const isPaid = result.status === "PAID" || result.status === "SUCCESS" || tx?.status === "CONFIRMED" || tx?.status === "SUCCESS";

    res.json({
      ...tx,
      status: isPaid ? "PAID" : result.status,
      rawStatus: tx?.status || result.status,
      resultCode: result.resultCode,
      resultDesc: result.resultDesc,
      mpesaReceiptNumber: isPaid ? (result.mpesaReceiptNumber || tx?.mpesaReceiptNumber) : undefined,
      downloadToken: isPaid ? (result.downloadToken || tx?.downloadToken) : undefined,
    });
  });

  // Universal payment status endpoint
  app.get("/api/payments/status/:id", paymentStatusLimiter, async (req: Request, res: Response) => {
    const { id } = req.params;
    const result = await queryPaymentStatus(id);
    
    if (!result) {
      return res.status(404).json({ error: "Transaction not found." });
    }

    const tx = store.getTransaction(id);
    const isPaid = result.status === "PAID" || result.status === "SUCCESS" || tx?.status === "CONFIRMED" || tx?.status === "SUCCESS";

    res.json({
      ...tx,
      status: isPaid ? "PAID" : result.status,
      rawStatus: tx?.status || result.status,
      resultCode: result.resultCode,
      resultDesc: result.resultDesc,
      mpesaReceiptNumber: isPaid ? (result.mpesaReceiptNumber || tx?.mpesaReceiptNumber) : undefined,
      downloadToken: isPaid ? (result.downloadToken || tx?.downloadToken) : undefined,
    });
  });

  // Safaricom Webhook Callback (Authoritative source of truth for payments)
  app.post("/api/mpesa/callback", async (req: Request, res: Response) => {
    const responsePayload = await handleDarajaCallback(req.body);
    res.json(responsePayload);
  });

  // Public Interaction Analytics Tracking
  app.post("/api/analytics/track", (req: Request, res: Response) => {
    try {
      const { eventType, articleId, category, readerHash, metadata } = req.body;
      const event = store.recordInteractionEvent({
        eventType,
        articleId,
        category,
        readerHash,
        metadata
      });
      res.json({ success: true, eventId: event.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to record event." });
    }
  });

  // ==========================================
  // PUBLIC READER ENGAGEMENT (LIKES & COMMENTS)
  // ==========================================

  // Get Likes status for a piece
  app.get("/api/articles/:id/like", (req: Request, res: Response) => {
    const { id } = req.params;
    const readerHash = (req.query.readerHash as string) || '';
    const likesData = store.getLikes(id);
    const hasLiked = readerHash ? store.hasReaderLiked(id, readerHash) : false;
    res.json({
      articleId: id,
      likesCount: likesData.count,
      hasLiked
    });
  });

  // Toggle Like for a piece
  app.post("/api/articles/:id/like", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { readerHash } = req.body;
      if (!readerHash) {
        return res.status(400).json({ error: "readerHash is required to like a piece." });
      }
      const result = store.toggleLike(id, readerHash);
      res.json({
        success: true,
        articleId: id,
        ...result
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to toggle like." });
    }
  });

  // Get Comments for a piece
  app.get("/api/articles/:id/comments", (req: Request, res: Response) => {
    const { id } = req.params;
    const comments = store.getComments(id, false);
    res.json(comments);
  });

  // Post Comment on a piece
  app.post("/api/articles/:id/comments", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { content, readerName, readerEmail, readerHash } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Comment text cannot be empty." });
      }
      const comment = store.addComment(id, content, readerName, readerEmail, readerHash);
      res.status(201).json({ success: true, comment });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to post comment." });
    }
  });

  // Report a comment
  app.post("/api/comments/:commentId/report", (req: Request, res: Response) => {
    try {
      const { commentId } = req.params;
      const { reason } = req.body;
      const updated = store.reportComment(commentId, reason);
      if (!updated) {
        return res.status(404).json({ error: "Comment not found." });
      }
      res.json({ success: true, message: "Comment flagged for moderation review." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to report comment." });
    }
  });

  // Delete own comment
  app.delete("/api/comments/:commentId", (req: Request, res: Response) => {
    try {
      const { commentId } = req.params;
      const readerHash = req.body?.readerHash || (req.query?.readerHash as string);
      const deleted = store.deleteComment(commentId, readerHash);
      if (!deleted) {
        return res.status(404).json({ error: "Comment not found." });
      }
      res.json({ success: true, message: "Comment deleted successfully." });
    } catch (err: any) {
      res.status(403).json({ error: err.message || "Could not delete comment." });
    }
  });

  // ==========================================
  // UNIFIED AUTHENTICATION API (PUBLIC)
  // ==========================================

  // Public unified login for both clients and administrators
  app.post("/api/auth/login", loginLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ success: false, error: "Email and password are required." });
      }

      const cleanEmail = email.trim().toLowerCase();
      const user = store.getUserByEmail(cleanEmail);

      // Generic response to prevent user enumeration
      if (!user) {
        await verifyPassword("$argon2id$v=19$m=65536,t=3,p=4$dummySaltString$dummyHashString", password).catch(() => {});
        return res.status(401).json({ success: false, error: "Invalid email or password." });
      }

      const isValid = await verifyPassword(user.passwordHash, password);
      if (!isValid) {
        return res.status(401).json({ success: false, error: "Invalid email or password." });
      }

      // Generate opaque cryptographically secure session
      const sessionId = await store.createAuthSession(user);
      setSessionCookie(res, sessionId);

      return res.json({
        success: true,
        token: sessionId,
        sessionId: sessionId,
        message: `Welcome back, ${user.name || user.email}!`,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          sessionId: sessionId
        }
      });
    } catch (err: any) {
      console.error("[Auth] Login error:", err);
      return res.status(500).json({ success: false, error: "An unexpected error occurred during sign-in." });
    }
  });

  // Public registration for readers/clients
  app.post("/api/auth/register", registerLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ success: false, error: "Email and password are required." });
      }

      const cleanEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({ success: false, error: "Please enter a valid email address." });
      }

      const strength = validatePasswordStrength(password);
      if (!strength.valid) {
        return res.status(400).json({ success: false, error: strength.error || "Password does not meet strength requirements." });
      }

      const existing = store.getUserByEmail(cleanEmail);
      if (existing) {
        return res.status(409).json({ success: false, error: "An account with this email already exists." });
      }

      const passwordHash = await hashPassword(password);
      const newUser = await store.createUser({
        email: cleanEmail,
        passwordHash,
        name: (name || cleanEmail.split('@')[0]).trim(),
        role: 'client'
      });

      const sessionId = await store.createAuthSession(newUser);
      setSessionCookie(res, sessionId);

      return res.status(201).json({
        success: true,
        message: "Account created successfully.",
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role
        }
      });
    } catch (err: any) {
      console.error("[Auth] Register error:", err);
      return res.status(500).json({ success: false, error: "An error occurred during account registration." });
    }
  });

  // Get current user session info
  app.get("/api/auth/me", (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) {
      return res.json({ authenticated: false, user: null });
    }
    return res.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  });

  // User Sign Out
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const sessionId = (req as any).cookies?.[SESSION_COOKIE_NAME] || (req as any).user?.sessionId;
    if (sessionId) {
      await store.invalidateAuthSession(sessionId);
    }
    clearSessionCookie(res);
    return res.json({ success: true, message: "Logged out successfully." });
  });

  // Auth System Status
  app.get("/api/auth/status", (_req: Request, res: Response) => {
    const allUsers = store.getAllUsers();
    const hasAdmin = allUsers.some(u => u.role === 'admin');
    return res.json({
      hasAdmin,
      totalUsers: allUsers.length
    });
  });

  // Reader Personal Library (Account-synced permanent web reading access)
  app.get("/api/user/library", (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ success: false, error: "Please sign in to access your personal reader library." });
    }

    const purchases = store.getUserPurchases(user.id);
    const articles = store.getArticles(false);

    const library = purchases.map(p => {
      const art = articles.find(a => a.id === p.articleId);
      return {
        ...p,
        article: art ? {
          ...art,
          isUnlocked: true
        } : null
      };
    }).filter(item => item.article !== null);

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      },
      library,
      totalCount: library.length
    });
  });

  // Reader Account: Link a purchased token or receipt to active user account
  app.post("/api/user/link-purchase", (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ success: false, error: "Please sign in to link purchases to your account." });
    }

    const { query } = req.body;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ success: false, error: "Please provide a valid M-Pesa receipt number, phone number, or unlock token." });
    }

    const result = store.linkUserPurchase(user.id, query.trim());
    return res.json(result);
  });

  // ==========================================
  // PRIVATE WRITER DASHBOARD API (PROTECTED)
  // ==========================================

  // Writer Auth: Verify active admin session
  app.get("/api/admin/verify", (req: Request, res: Response) => {
    const user = (req as any).user;
    if (user && user.role === 'admin') {
      return res.json({ valid: true, user });
    }
    return res.status(401).json({ valid: false, error: "Administrator session invalid or expired." });
  });

  // Writer Auth: Logout
  app.post("/api/admin/logout", async (req: Request, res: Response) => {
    const sessionId = (req as any).cookies?.[SESSION_COOKIE_NAME] || (req as any).user?.sessionId;
    if (sessionId) {
      await store.invalidateAuthSession(sessionId);
    }
    clearSessionCookie(res);
    return res.json({ success: true, message: "Logged out successfully." });
  });

  // Writer: Overview & Real-Time Stats
  app.get("/api/admin/stats", requireAdminAuth, (_req: Request, res: Response) => {
    const stats = store.getDashboardStats();
    res.json(stats);
  });

  // Writer: Get All Pieces (Drafts and Published with Full Content)
  app.get("/api/admin/articles", requireAdminAuth, (_req: Request, res: Response) => {
    const pieces = store.getArticles(true);
    res.json(pieces);
  });

  // Writer: Get Single Piece by ID (Draft or Published)
  app.get("/api/admin/articles/:id", requireAdminAuth, (req: Request, res: Response) => {
    const { id } = req.params;
    const article = store.getArticleById(id, true);
    if (!article) {
      return res.status(404).json({ error: "Piece not found." });
    }
    res.json(article);
  });

  // Writer: Create New Piece
  app.post("/api/admin/articles", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const {
        title,
        subtitle,
        category,
        categories,
        status,
        isPaid,
        priceKes,
        readTimeMinutes,
        excerpt,
        synopsis,
        content,
        coverImage,
        tags,
        featured,
        previewParagraphs,
        scheduledAt,
        seoTitle,
        metaDescription,
        manualRelatedPieceIds
      } = req.body;

      if (!title || !content) {
        return res.status(400).json({ error: "Title and content are required." });
      }

      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '') || `piece-${Date.now()}`;

      const assignedCategories = Array.isArray(categories) 
        ? categories 
        : (category ? [category.trim()] : []);

      const newArticle: Article = {
        id: `art-${Date.now()}`,
        title: title.trim(),
        subtitle: subtitle ? subtitle.trim() : "",
        slug,
        category: category ? category.trim() : (assignedCategories[0] || ""),
        categories: assignedCategories,
        status: status === 'published' ? 'published' : (status === 'scheduled' ? 'scheduled' : 'draft'),
        isPaid: isPaid !== false,
        priceKes: Number(priceKes) || 300,
        readTimeMinutes: Number(readTimeMinutes) || Math.max(3, Math.ceil(content.split(/\s+/).length / 200)),
        publishedAt: status === 'published' ? new Date().toISOString().split('T')[0] : "",
        scheduledAt: scheduledAt || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        featured: Boolean(featured),
        downloadsCount: 0,
        viewsCount: 0,
        tags: Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()) : ["Monograph"]),
        coverImage: coverImage || "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1200&q=80",
        excerpt: excerpt ? excerpt.trim() : "",
        synopsis: synopsis ? synopsis.trim() : undefined,
        previewParagraphs: Array.isArray(previewParagraphs) ? previewParagraphs : [],
        content: content.trim(),
        seoTitle: seoTitle || undefined,
        metaDescription: metaDescription || undefined,
        manualRelatedPieceIds: Array.isArray(manualRelatedPieceIds) ? manualRelatedPieceIds : undefined
      };

      const saved = await store.saveArticle(newArticle, true, "Initial creation");
      res.status(201).json({ success: true, article: saved });
    } catch (err: any) {
      console.error("Create piece error:", err);
      res.status(500).json({ error: err.message || "Failed to create piece." });
    }
  });

  // Writer: Update Existing Piece
  app.put("/api/admin/articles/:id", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existing = store.getArticleById(id, true);
      if (!existing) {
        return res.status(404).json({ error: "Piece not found." });
      }

      const updatedArticle: Article = {
        ...existing,
        ...req.body,
        id: existing.id, // preserve id
        updatedAt: new Date().toISOString()
      };

      // If status changed to published and no publishedAt set
      if (updatedArticle.status === 'published' && !updatedArticle.publishedAt) {
        updatedArticle.publishedAt = new Date().toISOString().split('T')[0];
      }

      const createRevision = Boolean(req.body.createRevision || req.body.revisionSummary);
      const saved = await store.saveArticle(updatedArticle, createRevision, req.body.revisionSummary || "Author update");
      res.json({ success: true, article: saved });
    } catch (err: any) {
      console.error("Update piece error:", err);
      res.status(500).json({ error: err.message || "Failed to update piece." });
    }
  });

  // Writer: Autosave Draft
  app.post("/api/admin/articles/:id/autosave", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existing = store.getArticleById(id, true);
      if (!existing) {
        return res.status(404).json({ error: "Piece not found." });
      }

      const updated: Article = {
        ...existing,
        ...req.body,
        id: existing.id,
        updatedAt: new Date().toISOString()
      };

      const saved = await store.saveArticle(updated, false);
      res.json({ success: true, article: saved, autosavedAt: saved.updatedAt });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Autosave failed." });
    }
  });

  // Writer: Get Piece Revisions History
  app.get("/api/admin/articles/:id/revisions", requireAdminAuth, (req: Request, res: Response) => {
    const { id } = req.params;
    const revisions = store.getArticleRevisions(id);
    res.json({ articleId: id, count: revisions.length, revisions });
  });

  // Writer: Restore Revision
  app.post("/api/admin/articles/:id/revisions/restore/:revisionId", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id, revisionId } = req.params;
      const restored = store.restoreArticleRevision(id, revisionId);
      if (!restored) {
        return res.status(404).json({ error: "Piece or revision not found." });
      }
      res.json({ success: true, article: restored, message: "Revision restored successfully." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to restore revision." });
    }
  });

  // Writer: Toggle Publish / Unpublish
  app.post("/api/admin/articles/:id/toggle-publish", requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    const toggled = await store.togglePublish(id);
    if (!toggled) {
      return res.status(404).json({ error: "Piece not found." });
    }
    res.json({ success: true, article: toggled });
  });

  // Writer: Delete Piece
  app.delete("/api/admin/articles/:id", requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    const deleted = await store.deleteArticle(id);
    if (!deleted) {
      return res.status(404).json({ error: "Piece not found." });
    }
    res.json({ success: true, message: "Piece permanently removed from catalog." });
  });

  // Writer: Manage Categories
  app.post("/api/admin/categories", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { name, description, order } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Category name is required." });
      }
      const category = store.saveCategory({ name: name.trim(), description, order });
      res.status(201).json({ success: true, category });
    } catch (err: any) {
      console.error("Create category error:", err);
      res.status(500).json({ error: err.message || "Failed to create category." });
    }
  });

  app.put("/api/admin/categories/:id", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, description, order } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Category name is required." });
      }
      const category = store.saveCategory({ id, name: name.trim(), description, order });
      res.json({ success: true, category });
    } catch (err: any) {
      console.error("Update category error:", err);
      res.status(500).json({ error: err.message || "Failed to update category." });
    }
  });

  app.delete("/api/admin/categories/:id", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = store.deleteCategory(id);
      if (!deleted) {
        return res.status(404).json({ error: "Category not found." });
      }
      res.json({ success: true, message: "Category deleted safely. Associated pieces were preserved." });
    } catch (err: any) {
      console.error("Delete category error:", err);
      res.status(500).json({ error: err.message || "Failed to delete category." });
    }
  });

  app.put("/api/admin/categories-reorder", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        return res.status(400).json({ error: "Invalid category IDs array." });
      }
      const reordered = store.reorderCategories(ids);
      res.json({ success: true, categories: reordered });
    } catch (err: any) {
      console.error("Reorder categories error:", err);
      res.status(500).json({ error: err.message || "Failed to reorder categories." });
    }
  });

  // Writer: Manage Topics Catalogue
  app.get("/api/admin/topics", requireAdminAuth, (_req: Request, res: Response) => {
    try {
      const topics = store.getTopics(true);
      res.json(topics);
    } catch (err: any) {
      console.error("Get admin topics error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch topics." });
    }
  });

  app.post("/api/admin/topics", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { name, description, slug, displayOrder, homepageVisible, pieceIds } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Topic name is required." });
      }
      const topic = store.saveTopic({
        name: name.trim(),
        description,
        slug,
        displayOrder,
        homepageVisible,
        pieceIds
      });
      res.status(201).json({ success: true, topic });
    } catch (err: any) {
      console.error("Create topic error:", err);
      res.status(500).json({ error: err.message || "Failed to create topic." });
    }
  });

  app.put("/api/admin/topics/:id", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, description, slug, displayOrder, homepageVisible, pieceIds } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Topic name is required." });
      }
      const topic = store.saveTopic({
        id,
        name: name.trim(),
        description,
        slug,
        displayOrder,
        homepageVisible,
        pieceIds
      });
      res.json({ success: true, topic });
    } catch (err: any) {
      console.error("Update topic error:", err);
      res.status(500).json({ error: err.message || "Failed to update topic." });
    }
  });

  app.delete("/api/admin/topics/:id", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = store.deleteTopic(id);
      if (!deleted) {
        return res.status(404).json({ error: "Topic not found." });
      }
      res.json({ success: true, message: "Topic removed. Associated pieces remain preserved." });
    } catch (err: any) {
      console.error("Delete topic error:", err);
      res.status(500).json({ error: err.message || "Failed to delete topic." });
    }
  });

  app.put("/api/admin/topics-reorder", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        return res.status(400).json({ error: "Invalid topic IDs array." });
      }
      const reordered = store.reorderTopics(ids);
      res.json({ success: true, topics: reordered });
    } catch (err: any) {
      console.error("Reorder topics error:", err);
      res.status(500).json({ error: err.message || "Failed to reorder topics." });
    }
  });

  app.post("/api/admin/topics/:id/pieces", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { pieceIds } = req.body;
      if (!Array.isArray(pieceIds)) {
        return res.status(400).json({ error: "pieceIds must be an array of article IDs." });
      }
      const updatedTopic = store.assignPiecesToTopic(id, pieceIds);
      res.json({ success: true, topic: updatedTopic });
    } catch (err: any) {
      console.error("Assign pieces to topic error:", err);
      res.status(500).json({ error: err.message || "Failed to assign pieces to topic." });
    }
  });

  app.get("/api/admin/topics-analytics", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const period = req.query.period as any;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const topicAnalytics = store.getTopicAnalytics({ period, startDate, endDate });
      res.json(topicAnalytics);
    } catch (err: any) {
      console.error("Topic analytics error:", err);
      res.status(500).json({ error: err.message || "Failed to load topic analytics." });
    }
  });

  // Writer: Comprehensive Analytics
  app.get("/api/admin/analytics", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const period = req.query.period as any;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const analytics = store.getDetailedAnalytics({ period, startDate, endDate });
      res.json(analytics);
    } catch (err: any) {
      console.error("Analytics error:", err);
      res.status(500).json({ error: err.message || "Failed to load analytics." });
    }
  });

  // Writer: Readers & Access Licenses
  app.get("/api/admin/readers", requireAdminAuth, (_req: Request, res: Response) => {
    try {
      const licenses = store.getReaderLicenses();
      res.json({ count: licenses.length, licenses });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load readers." });
    }
  });

  // Writer: Comments Moderation
  app.get("/api/admin/comments", requireAdminAuth, (_req: Request, res: Response) => {
    try {
      const comments = store.getComments(undefined, true);
      res.json({ count: comments.length, comments });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load comments." });
    }
  });

  app.put("/api/admin/comments/:commentId", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { commentId } = req.params;
      const { status } = req.body;
      if (!status || !['approved', 'hidden', 'deleted'].includes(status)) {
        return res.status(400).json({ error: "Valid status ('approved', 'hidden', 'deleted') is required." });
      }
      const updated = store.updateCommentStatus(commentId, status);
      if (!updated) {
        return res.status(404).json({ error: "Comment not found." });
      }
      res.json({ success: true, comment: updated, message: `Comment marked as ${status}.` });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update comment status." });
    }
  });

  app.delete("/api/admin/comments/:commentId", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { commentId } = req.params;
      const deleted = store.deleteComment(commentId);
      if (!deleted) {
        return res.status(404).json({ error: "Comment not found." });
      }
      res.json({ success: true, message: "Comment permanently deleted." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete comment." });
    }
  });

  // Writer: Manually Grant Reader License
  app.post("/api/admin/readers/grant", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { articleId, phone, receipt, durationDays } = req.body;
      if (!articleId || !phone) {
        return res.status(400).json({ error: "articleId and phone are required." });
      }
      const result = store.grantReaderLicense(articleId, phone, receipt, durationDays || 60);
      res.json({ success: true, ...result, message: "Access license granted." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to grant reader license." });
    }
  });

  // Writer: Revoke Reader License
  app.delete("/api/admin/readers/:token", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const revoked = store.revokeReaderLicense(token);
      if (!revoked) {
        return res.status(404).json({ error: "Access license not found." });
      }
      res.json({ success: true, message: "Reader access license revoked." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to revoke reader license." });
    }
  });

  // Writer: Get Manual Access Grants
  app.get("/api/admin/manual-access", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const articleId = req.query.articleId as string;
      const grants = store.getManualAccessGrants(articleId);
      res.json({ success: true, grants });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to retrieve manual access grants." });
    }
  });

  // Writer: Grant Manual Access
  app.post("/api/admin/manual-access/grant", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { articleId, phone, notes, grantedBy } = req.body;
      if (!articleId || !phone) {
        return res.status(400).json({ error: "articleId and phone are required." });
      }
      const result = store.grantManualAccess(articleId, phone, grantedBy || 'Jake', notes);
      res.json({ success: true, ...result, message: "Manual access authorization granted successfully." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to grant manual access." });
    }
  });

  // Writer: Revoke Manual Access (Marks status as revoked)
  app.post(["/api/admin/manual-access/revoke", "/api/admin/manual-access/:grantId/revoke"], requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const grantId = req.params.grantId || req.body.grantId;
      if (!grantId) {
        return res.status(400).json({ error: "grantId is required to revoke manual access." });
      }
      const revoked = store.revokeManualAccess(grantId);
      if (!revoked) {
        return res.status(404).json({ error: "Manual access grant not found." });
      }
      res.json({ success: true, message: "Manual access authorization revoked." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to revoke manual access grant." });
    }
  });

  // Writer: Delete Manual Access (Permanently removes record and manual tokens, protecting M-Pesa purchases)
  app.delete(["/api/admin/manual-access/:grantId", "/api/admin/manual-access"], requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const grantId = req.params.grantId || req.body.grantId;
      if (!grantId) {
        return res.status(400).json({ error: "grantId is required to delete manual access." });
      }
      const deleted = store.deleteManualAccess(grantId);
      if (!deleted) {
        return res.status(404).json({ error: "Manual access grant not found." });
      }
      res.json({ success: true, message: "Manual access authorization permanently deleted." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete manual access grant." });
    }
  });

  app.post("/api/admin/manual-access/delete", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { grantId } = req.body;
      if (!grantId) {
        return res.status(400).json({ error: "grantId is required to delete manual access." });
      }
      const deleted = store.deleteManualAccess(grantId);
      if (!deleted) {
        return res.status(404).json({ error: "Manual access grant not found." });
      }
      res.json({ success: true, message: "Manual access authorization permanently deleted." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete manual access grant." });
    }
  });

  // Writer: Reset Manual Access (Clears old account binding & allows genuine reader to re-activate)
  app.post("/api/admin/manual-access/reset", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { grantId } = req.body;
      if (!grantId) {
        return res.status(400).json({ error: "grantId or phone is required to reset manual access." });
      }
      const result = store.resetManualAccess(grantId);
      if (!result.success) {
        return res.status(404).json({ error: result.error || "Manual access grant not found." });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to reset manual access grant." });
    }
  });

  // Writer: Transactions CSV Export
  app.get("/api/admin/transactions/export", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const type = req.query.type as string;
      const status = req.query.status as string;
      const txList = store.getTransactions({ type, status });
      
      const headers = ['Transaction ID', 'Article Title', 'Amount (KES)', 'Type', 'Status', 'Payment Method', 'Receipt / Ref', 'Phone', 'Created At', 'Completed At'];
      const rows = txList.map(t => [
        `"${t.id || t.checkoutRequestId}"`,
        `"${(t.articleTitle || '').replace(/"/g, '""')}"`,
        t.amount || 0,
        t.type || 'PURCHASE',
        t.status,
        t.paymentMethod || 'mpesa',
        `"${t.mpesaReceiptNumber || t.bankReference || ''}"`,
        `"${t.phoneNumber || ''}"`,
        `"${t.createdAt}"`,
        `"${t.completedAt || ''}"`
      ]);

      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="ink-witness-transactions-${Date.now()}.csv"`);
      res.send(csv);
    } catch (err: any) {
      console.error("Export transactions error:", err);
      res.status(500).json({ error: "Failed to generate CSV export." });
    }
  });

  // Writer: Transactions Ledger (Pay-to-Read & Tips)
  app.get("/api/admin/transactions", requireAdminAuth, (req: Request, res: Response) => {
    const type = req.query.type as string;
    const status = req.query.status as string;
    const txList = store.getTransactions({ type, status });

    const totalRevenue = txList
      .filter(t => t.status === 'SUCCESS' || t.status === 'CONFIRMED')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    res.json({
      totalRevenueKes: totalRevenue,
      count: txList.length,
      transactions: txList,
    });
  });

  // Writer: Manually Confirm a Payment (M-Pesa or Bank)
  app.post("/api/admin/payments/:id/confirm", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { receiptNumber } = req.body;
      const result = store.confirmTransaction(id, receiptNumber);

      if (!result.success) {
        return res.status(404).json({ error: result.error || "Failed to confirm payment." });
      }

      res.json({
        success: true,
        transaction: result.transaction,
        downloadToken: result.downloadToken,
        message: "Payment successfully confirmed and piece unlocked."
      });
    } catch (err: any) {
      console.error("Payment confirmation error:", err);
      res.status(500).json({ error: err.message || "Failed to confirm payment." });
    }
  });

  // Writer: Mark Payment as Failed or Rejected
  app.post("/api/admin/payments/:id/reject", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const tx = store.getTransaction(id);
      if (!tx) {
        return res.status(404).json({ error: "Transaction not found." });
      }
      tx.status = "FAILED";
      tx.completedAt = new Date().toISOString();
      await store.saveTransaction(tx);
      res.json({ success: true, transaction: tx, message: "Payment marked as rejected/failed." });
    } catch (err: any) {
      console.error("Payment rejection error:", err);
      res.status(500).json({ error: err.message || "Failed to reject payment." });
    }
  });

  // Writer: Tips Ledger
  app.get("/api/admin/tips", requireAdminAuth, (_req: Request, res: Response) => {
    const tipsList = store.getTransactions({ type: 'TIP' });
    const verifiedTips = tipsList.filter(t => t.status === 'SUCCESS');
    const totalTipsKes = verifiedTips.reduce((sum, t) => sum + (t.amount || 0), 0);

    res.json({
      totalTipsKes,
      count: tipsList.length,
      verifiedCount: verifiedTips.length,
      tips: tipsList,
    });
  });

  // Writer: Update Author Profile
  app.put("/api/admin/author", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const updated = await store.saveAuthorProfile(req.body);
      res.json({ success: true, author: updated, message: "Profile saved successfully." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update author profile." });
    }
  });

  // Writer: Save Image Permanently into Database Storage
  app.post("/api/admin/save-permanent-image", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { target, imageUrl, dataUrl, articleId, cropSettings, originalUrl } = req.body;
      if (!target) {
        return res.status(400).json({ error: "Target type is required." });
      }
      if (!imageUrl && !dataUrl) {
        return res.status(400).json({ error: "No image source provided to save." });
      }

      const result = await store.savePermanentAsset({
        target,
        imageUrl: imageUrl || dataUrl,
        dataUrl,
        articleId,
        cropSettings,
        originalUrl
      });

      res.json(result);
    } catch (err: any) {
      console.error("Save permanent image error:", err);
      res.status(500).json({ error: err.message || "Failed to save image permanently." });
    }
  });

  // Writer: Upload and Persist Photos & Branding
  app.post("/api/admin/upload-image", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { dataUrl, target, articleId, prefix } = req.body;
      if (!dataUrl) {
        return res.status(400).json({ error: "No image data provided." });
      }

      const filePrefix = prefix || (target ? target.replace(/[^a-zA-Z0-9_-]/g, '_') : 'img');
      const saved = await store.saveUploadedImage(dataUrl, filePrefix);

      let updatedRecord: any = null;

      if (target === 'author_avatar') {
        updatedRecord = store.updateAuthorPhoto(saved.url);
      } else if (target === 'author_cover') {
        updatedRecord = store.updateAuthorCoverPhoto(saved.url);
      } else if (target === 'welcome_background') {
        updatedRecord = store.updateWelcomeBackground(saved.url);
      } else if (target === 'favicon') {
        updatedRecord = store.updateWebsiteFavicon(saved.url);
      } else if (target === 'logo') {
        updatedRecord = store.updateSiteLogo(saved.url);
      } else if (target === 'piece_cover' && articleId) {
        updatedRecord = store.updatePieceCoverPhoto(articleId, saved.url);
      }

      res.json({
        success: true,
        url: saved.url,
        filename: saved.filename,
        record: updatedRecord,
        message: "Uploaded successfully."
      });
    } catch (err: any) {
      console.error("Upload error:", err);
      res.status(400).json({ error: err.message || "Failed to upload image." });
    }
  });

  // Writer: Remove Photo / Branding
  app.post("/api/admin/remove-image", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { target, articleId } = req.body;
      let updatedRecord: any = null;

      if (target === 'author_avatar') {
        updatedRecord = store.removeAuthorPhoto();
      } else if (target === 'author_cover') {
        updatedRecord = store.removeAuthorCoverPhoto();
      } else if (target === 'welcome_background') {
        updatedRecord = store.removeWelcomeBackground();
      } else if (target === 'favicon') {
        updatedRecord = store.removeWebsiteFavicon();
      } else if (target === 'logo') {
        updatedRecord = store.removeSiteLogo();
      } else if (target === 'piece_cover' && articleId) {
        updatedRecord = store.removePieceCoverPhoto(articleId);
      }

      res.json({
        success: true,
        record: updatedRecord,
        message: "Image removed successfully."
      });
    } catch (err: any) {
      console.error("Remove image error:", err);
      res.status(400).json({ error: err.message || "Failed to remove image." });
    }
  });

  // Helper to safely mask M-Pesa secrets for response
  const formatSafeAdminMpesaConfig = (config: any) => {
    const maskedKey = config.consumerKey ? `${config.consumerKey.slice(0, 6)}••••••••${config.consumerKey.slice(-4)}` : '';
    const maskedSecret = config.consumerSecret ? '••••••••••••••••' : '';
    const maskedPasskey = config.passkey ? `${config.passkey.slice(0, 6)}••••••••${config.passkey.slice(-4)}` : '';

    return {
      ...config,
      consumerKey: maskedKey,
      consumerSecret: maskedSecret,
      passkey: maskedPasskey,
      hasConsumerKey: Boolean(config.consumerKey && config.consumerKey.trim().length > 0),
      hasConsumerSecret: Boolean(config.consumerSecret && config.consumerSecret.trim().length > 0),
      hasPasskey: Boolean(config.passkey && config.passkey.trim().length > 0)
    };
  };

  // Writer: Get M-Pesa Settings (Admin)
  const handleGetAdminMpesaConfig = (_req: Request, res: Response) => {
    try {
      const config = store.getMpesaSettings();
      res.json({
        success: true,
        config: formatSafeAdminMpesaConfig(config)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch M-Pesa settings." });
    }
  };

  app.get("/api/admin/mpesa", requireAdminAuth, handleGetAdminMpesaConfig);
  app.get("/api/admin/mpesa/config", requireAdminAuth, handleGetAdminMpesaConfig);

  // Writer: Update M-Pesa Settings
  app.post(["/api/admin/mpesa", "/api/admin/mpesa/config"], requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const current = store.getMpesaSettings();
      const toUpdate: any = { ...body };

      // Prevent overwriting real keys with masked values
      if (body.consumerKey && body.consumerKey.includes('••••')) {
        delete toUpdate.consumerKey;
      }
      if (body.consumerSecret && body.consumerSecret.includes('••••')) {
        delete toUpdate.consumerSecret;
      }
      if (body.passkey && body.passkey.includes('••••')) {
        delete toUpdate.passkey;
      }

      // Trim any accidental whitespace
      if (toUpdate.consumerKey && typeof toUpdate.consumerKey === 'string') {
        toUpdate.consumerKey = toUpdate.consumerKey.trim();
      }
      if (toUpdate.consumerSecret && typeof toUpdate.consumerSecret === 'string') {
        toUpdate.consumerSecret = toUpdate.consumerSecret.trim();
      }
      if (toUpdate.passkey && typeof toUpdate.passkey === 'string') {
        toUpdate.passkey = toUpdate.passkey.trim();
      }
      if (toUpdate.shortcode && typeof toUpdate.shortcode === 'string') {
        toUpdate.shortcode = toUpdate.shortcode.trim();
      }
      if (toUpdate.tillNumber && typeof toUpdate.tillNumber === 'string') {
        toUpdate.tillNumber = toUpdate.tillNumber.trim();
      }

      const updated = await store.saveMpesaSettings(toUpdate);
      res.json({ 
        success: true, 
        config: formatSafeAdminMpesaConfig(updated), 
        message: "M-Pesa payment settings updated securely." 
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update M-Pesa settings." });
    }
  });

  // Writer: Test M-Pesa Daraja Connection
  app.post("/api/admin/mpesa/test-connection", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const mpesaSettings = store.getMpesaSettings();
      const { consumerKey, consumerSecret } = req.body || {};
      
      const keyToUse = (consumerKey && !consumerKey.includes('••••')) ? consumerKey.trim() : (mpesaSettings.consumerKey || process.env.MPESA_TILL_CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY);
      const secretToUse = (consumerSecret && !consumerSecret.includes('••••')) ? consumerSecret.trim() : (mpesaSettings.consumerSecret || process.env.MPESA_TILL_SECRET_KEY || process.env.MPESA_CONSUMER_SECRET);

      if (!keyToUse || !secretToUse) {
        return res.status(400).json({
          success: false,
          error: "Consumer Key and Consumer Secret are required to test Daraja OAuth authentication."
        });
      }

      const token = await getDarajaAccessToken(keyToUse, secretToUse);

      if (!token) {
        return res.status(400).json({
          success: false,
          error: "Daraja OAuth request failed. Check your Consumer Key and Consumer Secret."
        });
      }

      res.json({
        success: true,
        message: "Successfully authenticated with Safaricom Daraja LIVE production endpoint! OAuth token generated and cached.",
        env: "production"
      });
    } catch (err: any) {
      console.error("Daraja test connection error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Failed to reach Safaricom Daraja API servers."
      });
    }
  });

  // Writer: Test STK Push directly to author handset
  app.post("/api/admin/mpesa/test-stk", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { phone, phoneNumber, amount } = req.body || {};
      const targetPhone = phone || phoneNumber;
      if (!targetPhone) {
        return res.status(400).json({ success: false, error: "Phone number is required for test STK Push." });
      }
      const formatted = formatKenyanPhone(targetPhone);
      const testAmount = Math.max(1, Number(amount) || 1);
      const stkResult = await initiateStkPush({
        phoneNumber: formatted,
        amount: testAmount,
        accountReference: "TESTSTK",
        articleId: "test_stk",
        articleTitle: "Test STK Push",
        type: "TIP",
      });

      if (!stkResult.checkoutRequestId || !stkResult.success) {
        return res.status(400).json({
          success: false,
          error: stkResult.error || "Failed to dispatch test STK Push to Safaricom."
        });
      }

      res.json({
        success: true,
        message: `Test STK prompt of KES ${testAmount} sent to +${formatted}! Check your phone.`,
        checkoutRequestId: stkResult.checkoutRequestId,
        merchantRequestId: stkResult.merchantRequestId
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Test STK Push failed." });
    }
  });

  // Writer: Get Homepage Management Data
  app.get("/api/admin/homepage", requireAdminAuth, (_req: Request, res: Response) => {
    try {
      const data = store.getHomepageConfig();
      const allPublished = store.getArticles(false);
      res.json({
        ...data,
        allPublishedPieces: allPublished
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch homepage data." });
    }
  });

  // Writer: Save Homepage Management Data
  app.put("/api/admin/homepage", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const result = await store.saveHomepageConfig(req.body);
      const allPublished = store.getArticles(false);
      res.json({
        success: true,
        ...result,
        allPublishedPieces: allPublished,
        message: "Homepage settings and curated sections saved successfully."
      });
    } catch (err: any) {
      console.error("Save homepage error:", err);
      res.status(500).json({ error: err.message || "Failed to save homepage settings." });
    }
  });

  // Writer: AI Writing Assistant with Gemini
  app.post("/api/admin/ai-assist", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { prompt, currentDraft, mode } = req.body;
      const client = getGeminiClient();

      if (!client) {
        return res.status(503).json({
          error: "Gemini API key is not configured in environment.",
        });
      }

      const systemPrompt = `You are an elite editorial collaborator working with Jake (@its_bigboy_jake), author of "Ink & Witness".
The voice is uncompromising, masculine, stoic, razor-sharp, strategic, and culturally acute (analyzing African commerce, power asymmetry, sovereignty, and geopolitics).
Avoid cliché corporate jargon or filler. Craft commanding, dense, resonant prose.`;

      let userPrompt = "";
      if (mode === "generate_outline") {
        userPrompt = `Generate an executive monograph outline for: "${prompt}".
Include:
1. Executive Title & Subtitle
2. Core Thesis Axiom
3. 3-4 Section Headings with core talking points
4. Opening paragraph teaser.`;
      } else if (mode === "refine_draft") {
        userPrompt = `Refine and elevate this draft monograph text. Enhance vocabulary, sharpen rhythmic cadence, and heighten philosophical gravitas:
---
${currentDraft || prompt}
---`;
      } else if (mode === "generate_excerpt") {
        userPrompt = `Write a gripping 2-paragraph executive synopsis/excerpt and 3 teaser preview paragraphs based on this monograph content:
---
${currentDraft || prompt}
---`;
      } else {
        userPrompt = prompt;
      }

      const response = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          { role: "user", parts: [{ text: `${systemPrompt}\n\nTask:\n${userPrompt}` }] }
        ],
      });

      res.json({
        success: true,
        result: response.text,
      });
    } catch (err: any) {
      console.error("AI Assist error:", err);
      res.status(500).json({ error: err.message || "Failed to generate AI editorial assistance." });
    }
  });

  // Writer: Export / Backup All Data JSON
  app.get("/api/admin/export", requireAdminAuth, (_req: Request, res: Response) => {
    const backup = store.getFullBackupArchive();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=ink-and-witness-backup-${new Date().toISOString().split('T')[0]}.json`);
    res.json(backup);
  });

  // Writer: List All Point-in-Time Snapshots
  app.get("/api/admin/backups", requireAdminAuth, (_req: Request, res: Response) => {
    try {
      const snapshots = store.listSnapshots();
      res.json({ success: true, snapshots });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to list snapshots." });
    }
  });

  // Writer: Create Manual Snapshot
  app.post("/api/admin/backups/snapshot", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const reason = (req.body?.reason as string) || 'manual_admin';
      const result = store.createSnapshotBackup(reason);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to create snapshot." });
    }
  });

  // Writer: Save Permanently to Cloud Firestore, Atomic Cache & Take Protected Baseline Snapshot
  app.post("/api/admin/save-permanently", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const reason = (req.body?.reason as string) || 'author_portal_save_permanently';
      const result = await store.savePermanently(reason);
      res.json(result);
    } catch (err: any) {
      console.error("Save permanently error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to permanently save baseline to Cloud Firestore." });
    }
  });

  // Writer: Restore State from Snapshot or Archive
  app.post("/api/admin/backups/restore", requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { archive, filename } = req.body;
      let targetArchive = archive;

      if (!targetArchive && filename) {
        const filePath = path.join(process.cwd(), 'data', 'backups', path.basename(filename));
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ success: false, error: "Snapshot file not found." });
        }
        targetArchive = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }

      if (!targetArchive) {
        return res.status(400).json({ success: false, error: "No archive payload or valid snapshot filename provided." });
      }

      const result = await store.restoreFromBackupArchive(targetArchive);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to restore backup archive." });
    }
  });

  // ==========================================
  // AFFILIATE & REFERRAL SYSTEM: PUBLIC & AFFILIATE PORTAL ROUTES
  // ==========================================

  // Public: Register Referral Click (Attribution)
  app.post("/api/affiliate/click", (req: Request, res: Response) => {
    try {
      const { ref, articleId, campaign } = req.body;
      if (!ref) {
        return res.status(400).json({ error: "Referral code is required" });
      }

      const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
      const ipHash = crypto.createHash('md5').update(ip).digest('hex').substring(0, 12);
      const userAgent = req.headers['user-agent'] as string;
      const referrer = req.headers.referer as string;

      const result = store.affiliates.registerClick(ref, articleId, campaign, ipHash, userAgent, referrer);
      res.json({
        success: result.valid,
        affiliateName: result.affiliate?.name
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to register click" });
    }
  });

  // Public: Validate Referral Code (Both query & param formats)
  const handleValidateRef = (req: Request, res: Response) => {
    try {
      const code = (req.params.code || req.query.code) as string;
      if (!code) {
        return res.json({ valid: false });
      }

      const aff = store.affiliates.getAffiliateByCode(code);
      if (!aff || aff.status !== 'active' || aff.linksDisabled) {
        return res.json({ valid: false });
      }

      res.json({
        valid: true,
        code: aff.affiliateCode,
        affiliateName: aff.name,
        name: aff.name,
        commissionRate: aff.customCommissionRate || store.affiliates.getSettings().defaultCommissionRate || 15
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to validate code", valid: false });
    }
  };

  app.get("/api/affiliate/validate-ref", handleValidateRef);
  app.get("/api/affiliate/validate/:code", handleValidateRef);

  // Public / Promoters: Affiliate Registration
  app.post("/api/affiliate/register", registerLimiter, (req: Request, res: Response) => {
    try {
      const settings = store.affiliates.getSettings();
      if (!settings.allowSelfRegistration) {
        return res.status(403).json({ success: false, error: "Affiliate self-registration is currently closed by the administrator." });
      }

      const { name, email, phone, password, payoutMethod, payoutDetails, affiliateCode, preferredCode, acceptedTerms, termsVersion } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({ success: false, error: "Name, email and password are required." });
      }

      if (!acceptedTerms) {
        return res.status(400).json({ success: false, error: "You must read and agree to all Affiliate Programme Terms & Conditions." });
      }

      if (password.length < 6) {
        return res.status(400).json({ success: false, error: "Password must be at least 6 characters." });
      }

      const now = new Date().toISOString();
      const passwordHash = hashAffiliatePassword(password);
      const newAffiliate = store.affiliates.createAffiliate({
        name,
        email,
        phone,
        passwordHash,
        payoutMethod: payoutMethod || 'mpesa',
        payoutDetails: payoutDetails || { mpesaPhone: phone, mpesaName: name },
        affiliateCode: affiliateCode || preferredCode,
        status: 'active',
        acceptedTerms: true,
        termsVersion: termsVersion || '2026.1',
        termsAcceptedAt: now
      }, 'Self-Registered');

      const token = store.affiliates.createAffiliateSession(newAffiliate.id);
      const dashboard = store.affiliates.getAffiliateDashboard(newAffiliate.id);

      res.json({
        success: true,
        token,
        affiliate: dashboard?.affiliate,
        message: "Affiliate account created successfully! Welcome to the Ink & Witness affiliate team."
      });
    } catch (err: any) {
      console.error("Affiliate registration error:", err);
      res.status(400).json({ success: false, error: err.message || "Failed to register affiliate account." });
    }
  });

  // Affiliate: Accept Terms & Conditions (For existing affiliates)
  app.post("/api/affiliate/accept-terms", requireAffiliateAuth, (req: Request, res: Response) => {
    try {
      const affiliate = (req as any).affiliate;
      const { termsVersion } = req.body;
      const now = new Date().toISOString();

      const updated = store.affiliates.updateAffiliate(affiliate.id, {
        acceptedTerms: true,
        termsVersion: termsVersion || '2026.1',
        termsAcceptedAt: now
      }, `Affiliate (${affiliate.name})`);

      const dashboard = store.affiliates.getAffiliateDashboard(updated.id);
      res.json({
        success: true,
        message: "Terms & Conditions accepted successfully. Your dashboard is now fully unlocked.",
        affiliate: dashboard?.affiliate,
        dashboard
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || "Failed to record Terms acceptance." });
    }
  });

  // Affiliate: Login
  app.post("/api/affiliate/login", loginLimiter, (req: Request, res: Response) => {
    try {
      const { login, emailOrCode, email, code, password } = req.body;
      const rawLogin = login || emailOrCode || email || code;
      
      if (!rawLogin || !password) {
        return res.status(400).json({ success: false, error: "Email or Affiliate Code and Password are required." });
      }

      const cleanLogin = String(rawLogin).trim();
      let aff = store.affiliates.getAffiliateByEmail(cleanLogin) || store.affiliates.getAffiliateByCode(cleanLogin);

      if (!aff) {
        return res.status(401).json({ success: false, error: "Invalid login credentials. Please check your email or affiliate code." });
      }

      if (aff.status === 'suspended') {
        return res.status(403).json({ success: false, error: "This affiliate account is currently suspended. Please contact the administrator at info@inkandwitness.com." });
      }

      if (!aff.passwordHash || !verifyAffiliatePassword(password, aff.passwordHash)) {
        return res.status(401).json({ success: false, error: "Incorrect password. Please verify and try again." });
      }

      // Update last login timestamp
      aff = store.affiliates.updateAffiliate(aff.id, { lastLoginAt: new Date().toISOString() }, 'System');

      const token = store.affiliates.createAffiliateSession(aff.id);
      const dashboard = store.affiliates.getAffiliateDashboard(aff.id);

      res.json({
        success: true,
        token,
        affiliate: dashboard?.affiliate,
        message: `Welcome back, ${aff.name}!`
      });
    } catch (err: any) {
      console.error("Affiliate login error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to authenticate affiliate." });
    }
  });

  // Affiliate: Logout
  app.post("/api/affiliate/logout", (req: Request, res: Response) => {
    const token = (req.headers['x-affiliate-token'] || req.headers.authorization?.replace('Bearer ', '')) as string;
    if (token) {
      store.affiliates.invalidateAffiliateSession(token);
    }
    res.json({ success: true, message: "Logged out successfully." });
  });

  // Helper for generating safe payout settings
  const formatSafePayoutSettings = (affiliate: any) => {
    const settings = store.affiliates.getSettings();
    const method = affiliate.payoutMethod || 'mpesa';
    let accountName = '';
    let accountNumberMasked = '';

    if (method === 'mpesa') {
      accountName = affiliate.payoutDetails?.mpesaName || affiliate.name || '';
      const phone = affiliate.payoutDetails?.mpesaPhone || affiliate.phone || '';
      accountNumberMasked = phone ? maskPhone(phone) : 'Not configured';
    } else if (method === 'bank') {
      accountName = affiliate.payoutDetails?.bankAccountName || affiliate.name || '';
      const num = affiliate.payoutDetails?.bankAccountNumber || '';
      accountNumberMasked = num ? `****${num.slice(-4)}` : 'Not configured';
    } else {
      accountName = affiliate.name || '';
      const email = affiliate.payoutDetails?.paypalEmail || affiliate.email || '';
      accountNumberMasked = email ? email.replace(/(?<=^..).*(?=@)/, '***') : 'Not configured';
    }

    return {
      method,
      accountName,
      accountNumberMasked,
      minimumPayout: settings.minPayoutThresholdKes || 1000,
      automaticPayoutsEnabled: true,
      payoutSchedule: "weekly",
      status: affiliate.status || "active"
    };
  };

  // Affiliate: Get My Dashboard / Overview (Supports /me, /dashboard, /stats, /overview)
  const handleGetAffiliateDashboard = (req: Request, res: Response) => {
    try {
      const affiliate = (req as any).affiliate;
      const dashboard = store.affiliates.getAffiliateDashboard(affiliate.id);
      if (!dashboard) {
        return res.status(404).json({ success: false, error: "Affiliate account not found." });
      }

      res.json({
        success: true,
        payoutSettings: formatSafePayoutSettings(affiliate),
        ...dashboard
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to fetch affiliate dashboard." });
    }
  };

  app.get("/api/affiliate/me", requireAffiliateAuth, handleGetAffiliateDashboard);
  app.get("/api/affiliate/dashboard", requireAffiliateAuth, handleGetAffiliateDashboard);
  app.get("/api/affiliate/stats", requireAffiliateAuth, handleGetAffiliateDashboard);
  app.get("/api/affiliate/overview", requireAffiliateAuth, handleGetAffiliateDashboard);

  // Affiliate: Payout Settings (GET)
  const handleGetPayoutSettings = (req: Request, res: Response) => {
    try {
      const affiliate = (req as any).affiliate;
      const settings = store.affiliates.getSettings();
      const safeAff = { ...affiliate };
      delete safeAff.passwordHash;

      res.json({
        success: true,
        payoutSettings: formatSafePayoutSettings(affiliate),
        availableBalance: affiliate.balanceAvailableKes || 0,
        minThreshold: settings.minPayoutThresholdKes || 1000,
        payoutMethod: affiliate.payoutMethod || 'mpesa',
        payoutDetails: affiliate.payoutDetails || {},
        affiliate: safeAff
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to load payout settings." });
    }
  };

  app.get("/api/affiliate/payout-settings", requireAffiliateAuth, handleGetPayoutSettings);
  app.get("/api/affiliate/payouts/settings", requireAffiliateAuth, handleGetPayoutSettings);
  app.get("/api/affiliate/settings", requireAffiliateAuth, handleGetPayoutSettings);
  app.get("/api/affiliate/profile", requireAffiliateAuth, handleGetPayoutSettings);

  // Affiliate: Update Payout / Contact Details (POST / PUT on /profile & /payout-settings)
  const handleUpdateProfile = (req: Request, res: Response) => {
    try {
      const affiliate = (req as any).affiliate;
      const { name, phone, payoutMethod, payoutDetails } = req.body;

      const updated = store.affiliates.updateAffiliate(affiliate.id, {
        name: name ? name.trim() : affiliate.name,
        phone: phone ? phone.trim() : affiliate.phone,
        payoutMethod: payoutMethod || affiliate.payoutMethod,
        payoutDetails: payoutDetails || affiliate.payoutDetails
      }, `Affiliate (${affiliate.name})`);

      const dashboard = store.affiliates.getAffiliateDashboard(updated.id);
      res.json({
        success: true,
        message: "Profile and payout details updated successfully.",
        payoutSettings: formatSafePayoutSettings(updated),
        ...dashboard
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || "Failed to update affiliate profile." });
    }
  };

  app.post("/api/affiliate/profile", requireAffiliateAuth, handleUpdateProfile);
  app.put("/api/affiliate/profile", requireAffiliateAuth, handleUpdateProfile);
  app.post("/api/affiliate/payout-settings", requireAffiliateAuth, handleUpdateProfile);
  app.put("/api/affiliate/payout-settings", requireAffiliateAuth, handleUpdateProfile);

  // Affiliate: Change Password
  app.post("/api/affiliate/change-password", requireAffiliateAuth, (req: Request, res: Response) => {
    try {
      const affiliate = (req as any).affiliate;
      const { currentPassword, newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, error: "New password must be at least 6 characters." });
      }

      if (affiliate.passwordHash && !verifyAffiliatePassword(currentPassword, affiliate.passwordHash)) {
        return res.status(401).json({ success: false, error: "Current password does not match." });
      }

      const passwordHash = hashAffiliatePassword(newPassword);
      store.affiliates.updateAffiliate(affiliate.id, { passwordHash }, `Affiliate (${affiliate.name})`);

      res.json({
        success: true,
        message: "Password changed successfully."
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || "Failed to update password." });
    }
  });

  // Affiliate: Links & Campaigns
  const handleGetLinks = (req: Request, res: Response) => {
    try {
      const affiliate = (req as any).affiliate;
      const campaigns = store.affiliates.getCampaigns().filter(c => c.isActive);
      const settings = store.affiliates.getSettings();

      res.json({
        success: true,
        affiliateCode: affiliate.affiliateCode,
        linksDisabled: Boolean(affiliate.linksDisabled),
        commissionRate: affiliate.customCommissionRate || settings.defaultCommissionRate || 15,
        attributionDays: affiliate.attributionDays || settings.defaultAttributionDays || 30,
        campaigns
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to fetch affiliate links." });
    }
  };

  app.get("/api/affiliate/links", requireAffiliateAuth, handleGetLinks);
  app.get("/api/affiliate/campaigns", requireAffiliateAuth, handleGetLinks);

  // Affiliate: Sales Ledger / Commissions
  const handleGetSales = (req: Request, res: Response) => {
    try {
      const affiliate = (req as any).affiliate;
      const sales = store.affiliates.getCommissions({ affiliateId: affiliate.id });
      res.json({
        success: true,
        sales,
        commissions: sales,
        totalSalesCount: sales.length
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to fetch sales ledger." });
    }
  };

  app.get("/api/affiliate/sales", requireAffiliateAuth, handleGetSales);
  app.get("/api/affiliate/commissions", requireAffiliateAuth, handleGetSales);
  app.get("/api/affiliate/ledger", requireAffiliateAuth, handleGetSales);

  // Affiliate: Payouts List / Balance
  const handleGetPayouts = (req: Request, res: Response) => {
    try {
      const affiliate = (req as any).affiliate;
      const payouts = store.affiliates.getPayouts({ affiliateId: affiliate.id });
      const settings = store.affiliates.getSettings();

      res.json({
        success: true,
        availableBalanceKes: affiliate.balanceAvailableKes || 0,
        pendingBalanceKes: affiliate.balancePendingKes || 0,
        paidBalanceKes: affiliate.totalCommissionPaidKes || 0,
        minThresholdKes: settings.minPayoutThresholdKes || 1000,
        payouts
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to fetch payouts." });
    }
  };

  app.get("/api/affiliate/payouts", requireAffiliateAuth, handleGetPayouts);
  app.get("/api/affiliate/payouts/history", requireAffiliateAuth, handleGetPayouts);
  app.get("/api/affiliate/payouts/balance", requireAffiliateAuth, handleGetPayouts);

  // Affiliate: Request Payout (Supports /request-payout and /payouts/request)
  const handleRequestPayout = (req: Request, res: Response) => {
    try {
      const affiliate = (req as any).affiliate;
      const { amount, amountKes, notes } = req.body;
      const requestedAmt = amountKes !== undefined ? amountKes : amount;

      const payout = store.affiliates.requestPayout(affiliate.id, requestedAmt ? Number(requestedAmt) : undefined, notes);
      const dashboard = store.affiliates.getAffiliateDashboard(affiliate.id);

      res.json({
        success: true,
        message: `Payout request of KES ${payout.amountKes.toLocaleString()} submitted successfully! Jake will review and disburse via ${payout.payoutMethod}.`,
        payout,
        ...dashboard
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || "Failed to request payout." });
    }
  };

  app.post("/api/affiliate/payouts/request", requireAffiliateAuth, handleRequestPayout);
  app.post("/api/affiliate/request-payout", requireAffiliateAuth, handleRequestPayout);

  // ==========================================
  // WRITER STUDIO: ADMIN AFFILIATE CONTROL ROUTES
  // ==========================================

  // Admin: Complete Affiliates Overview
  app.get("/api/admin/affiliates/summary", requireAdminAuth, (_req: Request, res: Response) => {
    try {
      const summary = store.affiliates.getAdminAffiliatesSummary();
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch admin affiliates summary." });
    }
  });

  // Admin: List All Affiliates
  app.get("/api/admin/affiliates", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const status = req.query.status as string;
      const affiliates = store.affiliates.getAffiliates(status ? { status } : undefined);
      res.json(affiliates);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch affiliates list." });
    }
  });

  // Admin: Get Affiliate by ID
  app.get("/api/admin/affiliates/:id", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const affiliate = store.affiliates.getAffiliateById(id);
      if (!affiliate) {
        return res.status(404).json({ error: "Affiliate not found." });
      }

      const commissions = store.affiliates.getCommissions({ affiliateId: id });
      const payouts = store.affiliates.getPayouts({ affiliateId: id });

      res.json({
        affiliate,
        commissions,
        payouts
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch affiliate details." });
    }
  });

  // Admin: Create Affiliate
  app.post("/api/admin/affiliates", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { 
        name, 
        email, 
        phone, 
        password, 
        affiliateCode, 
        customCommissionRate, 
        payoutMethod, 
        payoutDetails,
        allowedPieceIds,
        attributionDays,
        status,
        notes
      } = req.body;

      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required." });
      }

      const passwordHash = password ? hashAffiliatePassword(password) : hashAffiliatePassword("affiliate123");

      const created = store.affiliates.createAffiliate({
        name,
        email,
        phone,
        passwordHash,
        affiliateCode,
        customCommissionRate: customCommissionRate !== undefined && customCommissionRate !== null ? Number(customCommissionRate) : null,
        payoutMethod: payoutMethod || 'mpesa',
        payoutDetails: payoutDetails || { mpesaPhone: phone, mpesaName: name },
        allowedPieceIds: allowedPieceIds || [],
        attributionDays: attributionDays !== undefined ? Number(attributionDays) : null,
        status: status || 'active',
        notes
      }, 'Admin (Jake)');

      res.json({
        success: true,
        affiliate: created,
        message: `Affiliate ${created.name} (${created.affiliateCode}) created successfully.`
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to create affiliate." });
    }
  });

  // Admin: Update Affiliate
  app.put("/api/admin/affiliates/:id", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const patch = req.body;
      const updated = store.affiliates.updateAffiliate(id, patch, 'Admin (Jake)');
      res.json({
        success: true,
        affiliate: updated,
        message: `Affiliate ${updated.name} updated successfully.`
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to update affiliate." });
    }
  });

  // Admin: Delete Affiliate
  app.delete("/api/admin/affiliates/:id", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const success = store.affiliates.deleteAffiliate(id, 'Admin (Jake)');
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete affiliate." });
    }
  });

  // Admin: Set Status (Activate / Suspend)
  app.post("/api/admin/affiliates/:id/status", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, reason } = req.body;
      const updated = store.affiliates.setAffiliateStatus(id, status, 'Admin (Jake)', reason);
      res.json({
        success: true,
        affiliate: updated,
        message: `Affiliate status updated to ${status}.`
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to update affiliate status." });
    }
  });

  // Admin: Toggle Links Enabled/Disabled (Supports /links-toggle and /toggle-links)
  const handleAdminToggleLinks = (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { disabled, linksDisabled } = req.body;
      const shouldDisable = disabled !== undefined ? Boolean(disabled) : Boolean(linksDisabled);
      const updated = store.affiliates.toggleAffiliateLinks(id, shouldDisable, 'Admin (Jake)');
      res.json({
        success: true,
        affiliate: updated,
        message: `Referral links ${shouldDisable ? 'disabled' : 'enabled'} for ${updated.name}.`
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || "Failed to toggle links." });
    }
  };

  app.post("/api/admin/affiliates/:id/links-toggle", requireAdminAuth, handleAdminToggleLinks);
  app.post("/api/admin/affiliates/:id/toggle-links", requireAdminAuth, handleAdminToggleLinks);

  // Admin: Reset Affiliate Password
  app.post("/api/admin/affiliates/:id/reset-password", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;
      const pass = newPassword || `IW-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const passwordHash = hashAffiliatePassword(pass);
      const updated = store.affiliates.updateAffiliate(id, { passwordHash }, 'Admin (Jake)');
      res.json({
        success: true,
        temporaryPassword: pass,
        message: `Password reset successfully for ${updated.name}. Temporary password: ${pass}`
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || "Failed to reset password." });
    }
  });

  // Admin: Commissions Ledger
  app.get("/api/admin/affiliates/commissions", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const affiliateId = req.query.affiliateId as string;
      const status = req.query.status as string;
      const commissions = store.affiliates.getCommissions({ affiliateId, status });
      res.json(commissions);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to fetch commissions." });
    }
  });

  // Admin: Update Commission Status (Approve / Reverse / Reject)
  app.post("/api/admin/affiliates/commissions/:id/status", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, reason } = req.body;
      const commission = store.affiliates.updateCommissionStatus(id, status, 'Admin (Jake)', reason);
      res.json({
        success: true,
        commission,
        message: `Commission #${commission.receiptNumber} updated to ${status}.`
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || "Failed to update commission status." });
    }
  });

  // Admin: Payouts List
  app.get("/api/admin/affiliates/payouts", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const affiliateId = req.query.affiliateId as string;
      const status = req.query.status as string;
      const payouts = store.affiliates.getPayouts({ affiliateId, status });
      res.json(payouts);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to fetch payouts." });
    }
  });

  // Admin: Process Payout (Approve / Mark Paid / Reject)
  app.post("/api/admin/affiliates/payouts/:id/process", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { action, paymentReference, notes } = req.body;

      // Support 'pay' as an alias for 'mark_paid'
      const normalizedAction = action === 'pay' ? 'mark_paid' : action;

      if (!['approve', 'mark_paid', 'reject', 'fail'].includes(normalizedAction)) {
        return res.status(400).json({ success: false, error: "Invalid action. Supported: approve, mark_paid, pay, reject, fail" });
      }

      const payout = store.affiliates.processPayout(id, normalizedAction, paymentReference, notes, 'Admin (Jake)');
      res.json({
        success: true,
        payout,
        message: `Payout #${payout.id} processed successfully (${payout.status}).`
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || "Failed to process payout." });
    }
  });

  // Admin: Campaigns
  app.get("/api/admin/affiliates/campaigns", requireAdminAuth, (_req: Request, res: Response) => {
    try {
      const campaigns = store.affiliates.getCampaigns();
      res.json(campaigns);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to fetch campaigns." });
    }
  });

  app.post("/api/admin/affiliates/campaigns", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const campaign = store.affiliates.saveCampaign(req.body, 'Admin (Jake)');
      res.json({
        success: true,
        campaign,
        message: `Campaign "${campaign.name}" (${campaign.code}) saved.`
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || "Failed to save campaign." });
    }
  });

  app.delete("/api/admin/affiliates/campaigns/:id", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const success = store.affiliates.deleteCampaign(id, 'Admin (Jake)');
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to delete campaign." });
    }
  });

  // Admin: Settings (GET, POST, PUT)
  const handleAdminSettings = (req: Request, res: Response) => {
    try {
      const settings = store.affiliates.saveSettings(req.body, 'Admin (Jake)');
      res.json({
        success: true,
        settings,
        message: "Affiliate system settings updated successfully."
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || "Failed to save settings." });
    }
  };

  app.get("/api/admin/affiliates/settings", requireAdminAuth, (_req: Request, res: Response) => {
    try {
      const settings = store.affiliates.getSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to fetch settings." });
    }
  });

  app.post("/api/admin/affiliates/settings", requireAdminAuth, handleAdminSettings);
  app.put("/api/admin/affiliates/settings", requireAdminAuth, handleAdminSettings);

  // Admin: Audit Logs
  app.get("/api/admin/affiliates/audit-logs", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const logs = store.affiliates.getAuditLogs(limit);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to fetch audit logs." });
    }
  });

  // ==========================================
  // UNMATCHED API ROUTES: GUARANTEED JSON 404
  // ==========================================
  app.all("/api/*", (req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: `API route not found: ${req.method} ${req.path}`,
      code: "ROUTE_NOT_FOUND"
    });
  });

  // API Central Error Handler (Guaranteed JSON responses, never HTML)
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api/")) {
      console.error(`[API Error] ${req.method} ${req.path}:`, err);
      return res.status(err.status || 500).json({
        success: false,
        error: err.message || "Internal server error occurred.",
        code: err.code || "INTERNAL_ERROR"
      });
    }
    next(err);
  });

  // ==========================================
  // SEO UTILITIES: robots.txt & sitemap.xml
  // ==========================================
  app.get("/robots.txt", (_req: Request, res: Response) => {
    res.type("text/plain");
    res.send(`User-agent: *
Allow: /
Disallow: /api/admin/
Sitemap: /sitemap.xml
`);
  });

  app.get("/sitemap.xml", (req: Request, res: Response) => {
    const host = req.get("host") || "ink-and-witness.com";
    const proto = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const baseUrl = `${proto}://${host}`;
    const articles = store.getArticles().filter(a => a.status === 'published');

    const sitemapEntries = [
      `  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`,
      ...articles.map(art => `  <url>
    <loc>${baseUrl}/?article=${encodeURIComponent(art.slug || art.id)}</loc>
    <lastmod>${new Date(art.publishedAt || art.createdAt || Date.now()).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`)
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.join("\n")}
</urlset>`;

    res.type("application/xml");
    res.send(xml);
  });

  // ==========================================
  // VITE OR STATIC ASSETS
  // ==========================================
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    // Keep Vite out of the production/serverless module graph.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

// Local/AI Studio runtime. On Vercel the Express app is imported by api/[...path].
if (!process.env.VERCEL) {
  createApp().then((app) => {
    const PORT = Number(process.env.PORT) || 3000;
    http.createServer(app).listen(PORT, "0.0.0.0", () => {
      console.log(`[Ink & Witness] Server running on http://0.0.0.0:${PORT}`);
    });
  }).catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

