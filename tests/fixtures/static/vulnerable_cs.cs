// Comprehensive Insecure C# Test Fixture (Phase 2.7)
using System;
using System.Net;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace InsecureApp
{
    class Program
    {
        const int WeakKeyBits = 1024;

        static void Main(string[] args)
        {
            // 1. Weak Hashes: MD5 & SHA-1
            using (var md5 = MD5.Create())
            {
                byte[] hash = md5.ComputeHash(new byte[] { 1, 2, 3 });
            }
            using (var sha1 = SHA1.Create())
            {
                byte[] hash = sha1.ComputeHash(new byte[] { 1, 2, 3 });
            }

            // 2. Insecure Ciphers: DES, 3DES, RC2 & Insecure CipherMode.ECB
            using (var des = DES.Create())
            {
                des.Mode = CipherMode.ECB;
            }
            using (var tripleDes = TripleDES.Create())
            {
            }
            using (var rc2 = RC2.Create())
            {
            }

            // 3. Weak RSA Key Size & Weak Curve P-224
            using (var rsa = RSA.Create(WeakKeyBits))
            {
            }
            using (var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP224))
            {
            }

            // 4. Disabled Certificate Validation (returns true unconditionally)
            ServicePointManager.ServerCertificateValidationCallback = (sender, cert, chain, sslPolicyErrors) => true;

            // 5. Insecure TLS Protocol (TLS 1.0)
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls;

            // 6. Weak Certificate Signature Algorithm (MD5)
            var req = new CertificateRequest("cn=test", rsa, HashAlgorithmName.MD5, RSASignaturePadding.Pkcs1);
        }
    }
}
