package com.example.crypto

import java.security.*
import javax.crypto.*
import javax.net.ssl.*

class InsecureCryptoKt {
    fun runInsecure() {
        val weakAlgo = "DES/ECB/PKCS5Padding"
        val cipher = Cipher.getInstance(weakAlgo)
        val md = MessageDigest.getInstance("MD5")
        val mac = Mac.getInstance("HmacMD5")
        val sig = Signature.getInstance("SHA1withRSA")

        val kpg = KeyPairGenerator.getInstance("RSA")
        val smallBits = 1024
        kpg.initialize(smallBits)

        val ssl = SSLContext.getInstance("SSLv3")
    }
}
