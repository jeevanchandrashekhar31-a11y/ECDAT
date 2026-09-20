# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Token Management & Cryptographic Pinning Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import base64
import hashlib
import hmac
import json
import time
import pytest
from scanners.identity.token_verifier import TokenVerifier


def base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def make_jwt(header: dict, payload: dict, secret: str) -> str:
    h_b64 = base64url_encode(json.dumps(header).encode("utf-8"))
    p_b64 = base64url_encode(json.dumps(payload).encode("utf-8"))
    signing_input = f"{h_b64}.{p_b64}".encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    s_b64 = base64url_encode(sig)
    return f"{h_b64}.{p_b64}.{s_b64}"


class TestTokenManagementControl:
    """
    Security Control: Token Management & Cryptographic Signature Verification
    Guarantees algorithm pinning, expiration enforcement, and signature integrity.
    """

    SECRET = "synthetic-jwt-secret-signing-key-2026"

    @pytest.fixture
    def verifier(self):
        v = TokenVerifier(issuer="https://ecdat.internal/auth", audience="ecdat-api")
        v.add_key("k1", self.SECRET)
        return v

    # 1. POSITIVE TEST: Validly signed token with correct issuer and audience succeeds
    def test_positive_token(self, verifier):
        now = int(time.time())
        header = {"alg": "HS256", "typ": "JWT", "kid": "k1"}
        payload = {
            "sub": "user_42",
            "iss": "https://ecdat.internal/auth",
            "aud": "ecdat-api",
            "exp": now + 3600,
            "roles": ["analyst"],
        }
        token = make_jwt(header, payload, self.SECRET)
        verified = verifier.verify_token(token)

        assert verified["sub"] == "user_42"
        assert verified["_unverified"] is False
        assert "analyst" in verified["roles"]

    # 2. NEGATIVE TEST: Expired token raises ValueError
    def test_negative_token(self, verifier):
        now = int(time.time())
        header = {"alg": "HS256", "typ": "JWT", "kid": "k1"}
        payload = {
            "sub": "user_42",
            "iss": "https://ecdat.internal/auth",
            "aud": "ecdat-api",
            "exp": now - 60,  # Expired 1 minute ago
        }
        token = make_jwt(header, payload, self.SECRET)
        with pytest.raises(ValueError) as exc_info:
            verifier.verify_token(token)
        assert "expired" in str(exc_info.value).lower()

    # 3. BOUNDARY TEST: Malformed segments & empty tokens
    def test_boundary_token(self, verifier):
        # Empty string
        with pytest.raises(ValueError) as exc_info:
            verifier.verify_token("")
        assert "invalid" in str(exc_info.value).lower()

        # Only 2 segments instead of 3
        with pytest.raises(ValueError) as exc_info:
            verifier.verify_token("header.payload")
        assert "malformed" in str(exc_info.value).lower()

        # 4 segments
        with pytest.raises(ValueError) as exc_info:
            verifier.verify_token("h.p.s.extra")
        assert "malformed" in str(exc_info.value).lower()

    # 4. MALICIOUS TEST: Forged signature & tampered payload claims
    def test_malicious_token(self, verifier):
        now = int(time.time())
        header = {"alg": "HS256", "typ": "JWT", "kid": "k1"}
        payload = {
            "sub": "user_regular",
            "iss": "https://ecdat.internal/auth",
            "aud": "ecdat-api",
            "exp": now + 3600,
            "roles": ["viewer"],
        }
        valid_token = make_jwt(header, payload, self.SECRET)

        # Attacker modifies role in payload from viewer to platform administrator
        tampered_payload = dict(payload, roles=["platform administrator"])
        tampered_p_b64 = base64url_encode(json.dumps(tampered_payload).encode("utf-8"))
        parts = valid_token.split(".")
        tampered_token = f"{parts[0]}.{tampered_p_b64}.{parts[2]}"

        # Signature verification must reject tampered token
        with pytest.raises(ValueError) as exc_info:
            verifier.verify_token(tampered_token)
        assert "signature verification failed" in str(exc_info.value).lower()

    # 5. REGRESSION TEST: Rejection of alg="none" bypass vulnerability (SEC-REG-010)
    def test_regression_token(self, verifier):
        now = int(time.time())
        # Header specifies alg: none
        header_none = {"alg": "none", "typ": "JWT", "kid": "k1"}
        payload = {
            "sub": "attacker",
            "iss": "https://ecdat.internal/auth",
            "aud": "ecdat-api",
            "exp": now + 3600,
        }
        h_b64 = base64url_encode(json.dumps(header_none).encode("utf-8"))
        p_b64 = base64url_encode(json.dumps(payload).encode("utf-8"))
        unsigned_token = f"{h_b64}.{p_b64}."

        # Unsigned token without valid signature must fail verification
        with pytest.raises(Exception):
            verifier.verify_token(unsigned_token)

    # 6. TOKEN REVOCATION AUTHORIZATION: User A cannot revoke User B's token (returns 403)
    def test_user_a_revoking_user_b_token_returns_403(self):
        """Confirm user A attempting to revoke user B's token returns 403."""
        import json
        import subprocess
        from pathlib import Path

        repo_root = Path(__file__).resolve().parent.parent
        node_script = """
        const app = require('./src/app');
        const { defaultTokenService } = require('./src/identity');

        const server = app.listen(0, async () => {
            const port = server.address().port;
            const baseUrl = 'http://127.0.0.1:' + port;

            const tokenA = defaultTokenService.issueTokenPair({
                userId: 'usr_alice_' + Date.now(),
                email: 'alice@corp.test',
                roles: ['viewer'],
                customClaims: { tenantId: 'default-tenant' }
            });
            const tokenB = defaultTokenService.issueTokenPair({
                userId: 'usr_bob_' + Date.now(),
                email: 'bob@corp.test',
                roles: ['viewer'],
                customClaims: { tenantId: 'default-tenant' }
            });

            const resRevoke = await fetch(baseUrl + '/api/v1/auth/token/revoke', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + tokenA.accessToken,
                },
                body: JSON.stringify({ jti: tokenB.jti }),
            });
            const dataRevoke = await resRevoke.json();

            server.close();
            console.log(JSON.stringify({
                status: resRevoke.status,
                code: dataRevoke.code,
            }));
        });
        """
        proc = subprocess.run(
            ["node", "-e", node_script],
            cwd=str(repo_root / "backend"),
            capture_output=True,
            text=True,
            check=True,
        )
        lines = [l for l in proc.stdout.splitlines() if l.startswith("{")]
        result = json.loads(lines[-1])

        assert result["status"] == 403
        assert result["code"] == "FORBIDDEN"

    # 7. EXPIRED TOKEN INTEGRITY: Expired token returns 401
    def test_expired_token_returns_401(self):
        """Confirm expired token returns 401."""
        import json
        import subprocess
        from pathlib import Path

        repo_root = Path(__file__).resolve().parent.parent
        node_script = """
        const app = require('./src/app');
        const { defaultTokenService } = require('./src/identity');

        const server = app.listen(0, async () => {
            const port = server.address().port;
            const baseUrl = 'http://127.0.0.1:' + port;

            const expPayload = {
                sub: 'usr_exp',
                exp: Math.floor(Date.now() / 1000) - 300,
                iat: Math.floor(Date.now() / 1000) - 900,
                token_type: 'access',
                roles: ['viewer'],
            };
            const activeKey = defaultTokenService.secretManager.getActiveKey('jwt_signing');
            const expiredToken = defaultTokenService.signJwt(expPayload, activeKey.secret, activeKey.kid, activeKey.algorithm);

            const resExpired = await fetch(baseUrl + '/api/v1/auth/me', {
                headers: { 'Authorization': 'Bearer ' + expiredToken }
            });

            server.close();
            console.log(JSON.stringify({
                status: resExpired.status,
            }));
        });
        """
        proc = subprocess.run(
            ["node", "-e", node_script],
            cwd=str(repo_root / "backend"),
            capture_output=True,
            text=True,
            check=True,
        )
        lines = [l for l in proc.stdout.splitlines() if l.startswith("{")]
        result = json.loads(lines[-1])

        assert result["status"] == 401

    # 8. TAMPERED TOKEN SIGNATURE INTEGRITY: Tampered token signature returns 401
    def test_tampered_token_signature_returns_401(self):
        """Confirm tampered token signature returns 401."""
        import json
        import subprocess
        from pathlib import Path

        repo_root = Path(__file__).resolve().parent.parent
        node_script = """
        const app = require('./src/app');
        const { defaultTokenService } = require('./src/identity');

        const server = app.listen(0, async () => {
            const port = server.address().port;
            const baseUrl = 'http://127.0.0.1:' + port;

            const validTokenPair = defaultTokenService.issueTokenPair({
                userId: 'usr_valid_' + Date.now(),
                email: 'valid@corp.test',
                roles: ['viewer'],
                customClaims: { tenantId: 'default-tenant' }
            });

            // Tamper with signature bytes
            const parts = validTokenPair.accessToken.split('.');
            const tamperedSig = (parts[2].slice(0, -4) || 'xxxx') + 'abcd';
            const tamperedToken = parts[0] + '.' + parts[1] + '.' + tamperedSig;

            const resTampered = await fetch(baseUrl + '/api/v1/auth/me', {
                headers: { 'Authorization': 'Bearer ' + tamperedToken }
            });

            server.close();
            console.log(JSON.stringify({
                status: resTampered.status,
            }));
        });
        """
        proc = subprocess.run(
            ["node", "-e", node_script],
            cwd=str(repo_root / "backend"),
            capture_output=True,
            text=True,
            check=True,
        )
        lines = [l for l in proc.stdout.splitlines() if l.startswith("{")]
        result = json.loads(lines[-1])

        assert result["status"] == 401

