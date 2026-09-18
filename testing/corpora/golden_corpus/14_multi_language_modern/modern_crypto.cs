// @ecdat-synthetic-corpus
using System;
using System.Security.Cryptography;

namespace Ecdat.Corpus.Modern
{
    public class ModernCryptoServices
    {
        public static void EncryptPayload(byte[] key, byte[] nonce, byte[] plaintext, byte[] ciphertext, byte[] tag)
        {
            // AES-256-GCM authenticated encryption in .NET
            using (var aesGcm = new AesGcm(key, 16))
            {
                aesGcm.Encrypt(nonce, plaintext, ciphertext, tag);
            }
        }

        public static byte[] HashData(byte[] source)
        {
            // SHA-512 digest in .NET
            using (var sha512 = SHA512.Create())
            {
                return sha512.ComputeHash(source);
            }
        }

        public static ECDsa CreateEllipticCurveSigner()
        {
            // P-384 ECDSA asymmetric key generator in .NET
            return ECDsa.Create(ECCurve.NamedCurves.nistP384);
        }
    }
}
