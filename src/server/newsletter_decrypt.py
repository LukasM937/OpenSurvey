#!/usr/bin/env python3
"""
Newsletter-Adressen entschlüsseln und ausgeben.
Nur als newsletter-User ausführbar.

Verwendung:
  python3 newsletter_decrypt.py               # alle Adressen ausgeben
  python3 newsletter_decrypt.py --csv         # als CSV exportieren
  python3 newsletter_decrypt.py --count       # nur Anzahl
  python3 newsletter_decrypt.py --since 2025-05  # ab Monat filtern
"""

import argparse
import json
import sys
from base64 import b64decode
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PRIV_KEY_PATH = Path("/home/newsletter/private/newsletter_priv.pem")
NEWSLETTER_DIR = Path("/var/data/newsletter")
SUBSCRIBERS_FILE = NEWSLETTER_DIR / "subscribers.ndjson"


def load_private_key():
    if not PRIV_KEY_PATH.exists():
        print(f"FEHLER: Private Key nicht gefunden: {PRIV_KEY_PATH}", file=sys.stderr)
        sys.exit(1)
    pem = PRIV_KEY_PATH.read_bytes()
    return serialization.load_pem_private_key(pem, password=None)


def decrypt_entry(private_key, entry: dict) -> dict:
    """Entschlüsselt einen einzelnen Newsletter-Eintrag."""
    if not entry.get("encrypted"):
        return entry  # Älterer Eintrag ohne Verschlüsselung

    # AES-Key mit RSA-OAEP entschlüsseln
    enc_key = b64decode(entry["enc_key"])
    aes_key = private_key.decrypt(
        enc_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )

    # Daten mit AES-256-GCM entschlüsseln
    nonce = b64decode(entry["nonce"])
    ciphered = b64decode(entry["enc_data"])
    aesgcm = AESGCM(aes_key)
    plaintext = aesgcm.decrypt(nonce, ciphered, None)
    payload = json.loads(plaintext)

    return {**entry, **payload, "encrypted": False}


def main():
    parser = argparse.ArgumentParser(description="Newsletter-Adressen entschlüsseln")
    parser.add_argument("--csv", action="store_true", help="CSV-Ausgabe")
    parser.add_argument("--count", action="store_true", help="Nur Anzahl")
    parser.add_argument("--since", metavar="YYYY-MM", help="Nur ab diesem Monat")
    args = parser.parse_args()

    if not SUBSCRIBERS_FILE.exists():
        print("Keine Einträge vorhanden.")
        sys.exit(0)

    private_key = load_private_key()
    entries = []

    with open(SUBSCRIBERS_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
                dec = decrypt_entry(private_key, raw)
                if args.since:
                    stored = dec.get("_stored_at", "")[:7]
                    if stored < args.since:
                        continue
                entries.append(dec)
            except Exception as e:
                print(f"WARNUNG: Eintrag konnte nicht entschlüsselt werden: {e}", file=sys.stderr)

    if args.count:
        print(len(entries))
        return

    if args.csv:
        import csv
        import io

        out = io.StringIO()
        writer = csv.DictWriter(out, fieldnames=["email", "lang", "consent_at", "_stored_at"])
        writer.writeheader()
        for e in entries:
            writer.writerow(
                {
                    "email": e.get("email", ""),
                    "lang": e.get("lang", ""),
                    "consent_at": e.get("consent_at", ""),
                    "_stored_at": e.get("_stored_at", ""),
                }
            )
        print(out.getvalue(), end="")
        return

    # Standard: eine E-Mail pro Zeile
    for e in entries:
        print(e.get("email", ""))


if __name__ == "__main__":
    main()
