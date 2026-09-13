// Secure C# Test Fixture (Phase 2.7)
using System;
using System.Net;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace SecureApp
{
    class Program
    {
        static void Main(string[] args)
        {
            // 1. Secure Hashes: SHA-256 & SHA-512
            using (var sha256 = SHA256.Create())
            {
                byte[] hash = sha256.ComputeHash(new byte[] { 1, 2, 3 });
            }
            using (var sha512 = SHA512.Create())
            {
                byte[] hash = sha512.ComputeHash(new byte[] { 1, 2, 3 });
            }

            // 2. Modern Standard AES Cipher
            using (var aes = Aes.Create())
            {
                aes.Mode = CipherMode.CBC; // Non-ECB mode
            }

            // 3. Strong RSA Key (4096) & NIST P-384 Curve
            using (var rsa = RSA.Create(4096))
            {
            }
            using (var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP384))
            {
            }

            // 4. Secure TLS Protocols: TLS 1.3
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls13;

            // 5. Secure Certificate Request with SHA-256
            var req = new CertificateRequest("cn=secure", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pss);
        }
    }
}
