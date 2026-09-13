package com.example.crypto

import java.security.*
import javax.crypto.*
import javax.net.ssl.*

class SecureCryptoKt {
    fun runSecure() {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val md = MessageDigest.getInstance("SHA-256")
        val kpg = KeyPairGenerator.getInstance("RSA")
        kpg.initialize(3072)
        val ssl = SSLContext.getInstance("TLSv1.3")
    }
}
