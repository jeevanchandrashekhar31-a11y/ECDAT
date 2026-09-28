const crypto = require("crypto");
const config = require("../config");
const { defaultTokenService } = require("../identity/token_service");

const EVAL_TENANT_PREFIX = "eval-";
const EVAL_COOKIE_NAME = "ecdat_eval_session";

/**
 * Ensures we are not running evaluation mode with real production secrets
 */
function validateEvalEnvironment() {
  if (config.ECDAT_MODE !== "evaluation") return;

  const realSecretsPresent = 
    process.env.AWS_ACCESS_KEY_ID || 
    process.env.AWS_SECRET_ACCESS_KEY || 
    process.env.AZURE_CLIENT_ID || 
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (realSecretsPresent) {
    console.error("FATAL: Cannot start in evaluation mode when real cloud secrets are present. Clear cloud credentials first.");
    process.exit(1);
  }

  if (!config.ECDAT_EVAL_ALLOW_REMOTE_DB && config.DATABASE_URL) {
    if (!config.DATABASE_URL.includes("localhost") && !config.DATABASE_URL.includes("127.0.0.1") && !config.DATABASE_URL.includes("sqlite")) {
      console.warn("WARN: Starting in evaluation mode with a remote DATABASE_URL.");
    }
  }
}

/**
 * Intercepts auth to automatically authenticate eval sessions
 */
function evalAuthMiddleware(req, res, next) {
  if (config.ECDAT_MODE !== "evaluation") return next();

  const isEvalSessionRoute = req.path === "/api/v1/eval/session" || req.path === "/api/v1/eval/persona";
  if (isEvalSessionRoute) return next();

  const evalCookie = req.cookies ? req.cookies[EVAL_COOKIE_NAME] : null;
  const cookieString = req.headers.cookie || "";
  
  let token = evalCookie;
  if (!token && cookieString.includes(EVAL_COOKIE_NAME)) {
    const match = cookieString.match(new RegExp(`${EVAL_COOKIE_NAME}=([^;]+)`));
    if (match) token = match[1];
  }

  if (token) {
    try {
      const payload = defaultTokenService.verifyToken(token, "access");
      if (payload && payload.isEval) {
        // Automatic full access in eval mode
        req.auth = { authenticated: true, mode: "eval", role: payload.persona || "analyst", roles: [payload.persona || "analyst"] };
        req.user = { 
          id: payload.userId, 
          username: payload.userId,
          role: payload.persona || "analyst",
          tenantId: payload.tenantId 
        };
        // Scope queries to eval tenant
        req.tenantId = payload.tenantId;
        return next();
      }
    } catch (e) {
      // Ignore token errors, fall through
    }
  }

  // Not authenticated, let downstream logic handle it or block it if they hit a protected route
  next();
}

/**
 * Hides production features in eval mode
 */
function hideProductionFeatures(req, res, next) {
  if (config.ECDAT_MODE !== "evaluation") return next();

  const hiddenRoutes = [
    "/api/v1/kms",
    "/api/v1/ticketing",
    "/api/v1/telemetry/ebpf",
    "/api/v1/admin",
    "/api/v1/auth/mfa",
    "/api/v1/auth/password",
    "/api/v1/auth/users",
    "/api/v1/auth/secrets"
  ];

  for (const hidden of hiddenRoutes) {
    if (req.path.startsWith(hidden)) {
      return res.status(404).json({ error: "Not Found", message: "This production feature is hidden in evaluation mode." });
    }
  }
  
  next();
}

/**
 * Route handler: Creates an ephemeral eval session
 */
function createEvalSession(req, res) {
  if (config.ECDAT_MODE !== "evaluation") return res.status(404).send();

  const tenantId = `${EVAL_TENANT_PREFIX}${crypto.randomBytes(8).toString("hex")}`;
  const userId = `judge-${crypto.randomBytes(4).toString("hex")}`;
  const persona = req.body.persona === "approver" ? "approver" : "analyst";

  const payload = {
    isEval: true,
    tenantId,
    userId,
    persona,
    token_type: "access"
  };

  const activeKey = defaultTokenService.secretManager.getActiveKey("jwt_signing");
  const token = defaultTokenService.signJwt(payload, activeKey.secret, activeKey.kid, activeKey.algorithm);

  res.cookie(EVAL_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000 // 24h
  });

  res.json({
    accessToken: token,
    refreshToken: token,
    csrfToken: "eval-csrf-bypass",
    evaluationMode: true,
    user: {
      userId,
      username: userId,
      displayName: `Evaluation ${persona.charAt(0).toUpperCase() + persona.slice(1)}`,
      email: `${userId}@eval.ecdat.local`,
      roles: [persona],
      tenantId,
      isPlatformAdmin: false,
      isEvaluation: true
    }
  });
}

/**
 * Route handler: Switches persona in eval session
 */
function switchEvalPersona(req, res) {
  if (config.ECDAT_MODE !== "evaluation") return res.status(404).send();

  if (!req.user || !req.user.tenantId) {
    return res.status(401).json({ error: "No active eval session" });
  }

  const persona = req.body.persona === "approver" ? "approver" : "analyst";
  
  const payload = {
    isEval: true,
    tenantId: req.user.tenantId,
    userId: req.user.id, // Keep same user ID or rotate? Let's rotate user ID so four-eyes works (proposer != approver)
    persona,
    token_type: "access"
  };
  
  // Rotate user ID when switching to approver so they can approve their own previous work as "another user"
  payload.userId = `judge-${crypto.randomBytes(4).toString("hex")}`;

  const activeKey = defaultTokenService.secretManager.getActiveKey("jwt_signing");
  const token = defaultTokenService.signJwt(payload, activeKey.secret, activeKey.kid, activeKey.algorithm);

  res.cookie(EVAL_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000 // 24h
  });

  res.json({
    accessToken: token,
    refreshToken: token,
    csrfToken: "eval-csrf-bypass",
    evaluationMode: true,
    user: {
      userId: payload.userId,
      username: payload.userId,
      displayName: `Evaluation ${persona.charAt(0).toUpperCase() + persona.slice(1)}`,
      email: `${payload.userId}@eval.ecdat.local`,
      roles: [persona],
      tenantId: payload.tenantId,
      isPlatformAdmin: false,
      isEvaluation: true
    }
  });
}

module.exports = {
  validateEvalEnvironment,
  evalAuthMiddleware,
  hideProductionFeatures,
  createEvalSession,
  switchEvalPersona
};
