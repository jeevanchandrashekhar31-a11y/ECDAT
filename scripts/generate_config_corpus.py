import os

CORPUS_DIR = os.path.join(os.path.dirname(__file__), "..", "benchmarks", "config_golden_corpus")

def generate():
    os.makedirs(CORPUS_DIR, exist_ok=True)
    
    # haproxy
    with open(os.path.join(CORPUS_DIR, "haproxy.cfg"), "w") as f:
        f.write("""
global
    ssl-default-bind-options no-sslv3 no-tlsv10 no-tlsv11
    ssl-default-bind-ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256
    
defaults
    mode http

frontend https_front
    bind :443 ssl crt /etc/ssl/certs/ cert.pem ciphers ECDHE-ECDSA-AES256-GCM-SHA384
""")

    # sshd
    with open(os.path.join(CORPUS_DIR, "sshd_config"), "w") as f:
        f.write("""
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com
KexAlgorithms curve25519-sha256@libssh.org,diffie-hellman-group14-sha256
MACs hmac-sha2-512-etm@openssh.com

Match User admin
    Ciphers aes128-ctr
""")

    # openssl
    with open(os.path.join(CORPUS_DIR, "openssl.cnf"), "w") as f:
        f.write("""
[system_default_sect]
MinProtocol = TLSv1.2
CipherString = DEFAULT@SECLEVEL=2
""")

    # java
    with open(os.path.join(CORPUS_DIR, "java.security"), "w") as f:
        f.write("""
jdk.tls.disabledAlgorithms=SSLv3, TLSv1, TLSv1.1, RC4, DES, MD5withRSA, \
    DH keySize < 1024, EC keySize < 224, 3DES_EDE_CBC
""")

    # nginx
    with open(os.path.join(CORPUS_DIR, "nginx.conf"), "w") as f:
        f.write("""
server {
    listen 443 ssl;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
}
""")

    print(f"Generated test config corpus in {CORPUS_DIR}")

if __name__ == "__main__":
    generate()
