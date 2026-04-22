#!/usr/bin/env python3
"""
Einmalig ausführen als newsletter-User um das Schlüsselpaar zu generieren.
  sudo -u newsletter python3 newsletter_keygen.py
"""
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization
from pathlib import Path
import os, sys

PRIV_PATH = Path("/home/newsletter/private/newsletter_priv.pem")
PUB_PATH  = Path("/etc/survey/newsletter_pub.pem")

if PRIV_PATH.exists():
    print(f"FEHLER: {PRIV_PATH} existiert bereits. Abbruch.")
    sys.exit(1)

# Verzeichnisse anlegen
PRIV_PATH.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
PUB_PATH.parent.mkdir(mode=0o755, parents=True, exist_ok=True)

# RSA-4096 Schlüsselpaar generieren
print("Generiere RSA-4096 Schlüsselpaar...")
private_key = rsa.generate_private_key(public_exponent=65537, key_size=4096)

# Private Key speichern – nur newsletter-User darf lesen
priv_pem = private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)
PRIV_PATH.write_bytes(priv_pem)
os.chmod(PRIV_PATH, 0o600)
print(f"Private Key: {PRIV_PATH}  (chmod 600)")

# Public Key speichern – umfrage-User darf lesen
pub_pem = private_key.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
)
PUB_PATH.write_bytes(pub_pem)
os.chmod(PUB_PATH, 0o644)
print(f"Public Key:  {PUB_PATH}  (chmod 644)")

print("\n✓ Schlüsselpaar generiert.")
print(f"\nPublic Key Fingerprint (SHA-256):")
import hashlib
fp = hashlib.sha256(pub_pem).hexdigest()
print(f"  {fp[:16]}...{fp[-16:]}")
print("\nNächster Schritt: Public Key Pfad in server.py eintragen.")
