/* eslint-disable no-console */
import { Request, Response, NextFunction } from "express";
import { decode, verify, JwtPayload } from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { randomBytes } from "crypto";
import Company from "../models/Company";
import User from "../models/User";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Valora SSO middleware
// ---------------------------------------------------------------------------
// Sits BEFORE the native isAuth middleware in app.ts.
//
//   1. If there's no Authorization header → next() (isAuth will reject).
//   2. If the token is signed by Valora (kid resolves in our JWKS) →
//        validate (RS256, iss, aud, exp), JIT-provision Company+User if
//        needed, set req.user + req.companyId, then next().
//      isAuth will see req.user already populated and skip its native check
//      (it has an early `if (req?.user) return next();`).
//   3. If the token is NOT a Valora token (kid missing/unknown, or no kid
//        header) → next() WITHOUT touching req.user. The native isAuth then
//        validates as a Ticketz-native HMAC token.
//
// This keeps native Ticketz auth as a working fallback (per integration plan).
// ---------------------------------------------------------------------------

const JWKS_URL = process.env.VALORA_JWKS_URL;
const ISSUER = process.env.VALORA_JWT_ISSUER || "valora-smart";
const AUDIENCE = process.env.VALORA_JWT_AUDIENCE || "valora-ticketz";

const jwks = JWKS_URL
  ? jwksClient({
      jwksUri: JWKS_URL,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000, // 10 min
      rateLimit: true,
      jwksRequestsPerMinute: 60
    })
  : null;

interface ValoraClaims extends JwtPayload {
  ezcale_user_id: string;
  ezcale_tenant_id: string;
  email: string;
  name: string;
  role: string;
}

export interface ValoraAuthResult {
  user: User;
  company: Company;
  claims: ValoraClaims;
}

async function getSigningKey(kid: string): Promise<string | null> {
  if (!jwks) return null;
  try {
    const key = await jwks.getSigningKey(kid);
    return key.getPublicKey();
  } catch {
    return null;
  }
}

async function provisionCompanyAndUser(
  claims: ValoraClaims
): Promise<{ company: Company; user: User }> {
  const tenantId = claims.ezcale_tenant_id;
  const userId = claims.ezcale_user_id;

  let company = await Company.findOne({ where: { externalId: tenantId } });
  if (!company) {
    // Valora controls subscription/billing — set a far-future dueDate so the
    // native isCompliant middleware never blocks Valora-provisioned tenants.
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 10);

    company = await Company.create({
      name: `Valora ${tenantId}`,
      email: claims.email,
      status: true,
      externalId: tenantId,
      dueDate: farFuture.toISOString(),
      recurrence: "annual"
    } as any);
    logger.info(
      { tenantId, companyId: company.id },
      "[valoraAuth] provisioned new company"
    );
  }

  let user = await User.findOne({
    where: { externalId: userId, companyId: company.id }
  });

  // Same Valora user may already have a Ticketz row under another company
  // (e.g. invited as agent across multiple companies). Email is globally
  // unique in Ticketz, so we keep ONE Users row per email and just (re)attach
  // it to the current company on this request.
  if (!user) {
    user = await User.findOne({ where: { email: claims.email } });
    if (user) {
      await user.update({
        companyId: company.id,
        externalId: userId,
        profile: claims.role === "admin" ? "admin" : "user"
      });
      logger.info(
        { userId: user.id, companyId: company.id, externalId: userId },
        "[valoraAuth] re-attached existing user to company"
      );
    }
  }

  if (!user) {
    // SSO users authenticate via Valora JWT — they never log in directly. Set
    // a random password so the BeforeCreate hook produces a valid passwordHash
    // (column is NOT NULL). The cleartext is discarded after hashing.
    const ssoPassword = randomBytes(24).toString("hex");
    user = await User.create({
      name: claims.name || claims.email,
      email: claims.email,
      password: ssoPassword,
      profile: claims.role === "admin" ? "admin" : "user",
      companyId: company.id,
      externalId: userId
    } as any);
    logger.info(
      { userId: user.id, companyId: company.id, externalId: userId },
      "[valoraAuth] provisioned new user"
    );
  } else if (user.profile !== claims.role && claims.role) {
    await user.update({
      profile: claims.role === "admin" ? "admin" : "user"
    });
  }

  return { company, user };
}

/**
 * Try to authenticate `token` as a Valora-signed RS256 JWT.
 * Returns null when the token is not addressed to us (no kid, unknown kid,
 * wrong alg, or no JWKS configured) — caller should fall back to native auth.
 * Throws nothing: token validation errors yield null too.
 */
export async function tryAuthenticateValora(
  token: string
): Promise<ValoraAuthResult | null> {
  if (!token || !jwks) return null;

  const decoded = decode(token, { complete: true });
  if (!decoded || typeof decoded === "string") return null;

  const kid = decoded.header?.kid;
  const alg = decoded.header?.alg;
  if (!kid || alg !== "RS256") return null;

  const publicKey = await getSigningKey(kid);
  if (!publicKey) return null;

  let claims: ValoraClaims;
  try {
    claims = verify(token, publicKey, {
      algorithms: ["RS256"],
      issuer: ISSUER,
      audience: AUDIENCE
    }) as ValoraClaims;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "[valoraAuth] invalid token (signature/iss/aud/exp)"
    );
    return null;
  }

  if (!claims.ezcale_user_id || !claims.ezcale_tenant_id) return null;

  try {
    const { company, user } = await provisionCompanyAndUser(claims);
    return { company, user, claims };
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      "[valoraAuth] provisioning failed"
    );
    return null;
  }
}

const valoraAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();

  const [, token] = authHeader.split(" ");
  if (!token) return next();

  const result = await tryAuthenticateValora(token);
  if (result) {
    req.user = {
      id: String(result.user.id),
      profile: result.user.profile,
      isSuper: false,
      companyId: result.company.id
    };
    req.companyId = result.company.id;
  }

  return next();
};

export default valoraAuth;
