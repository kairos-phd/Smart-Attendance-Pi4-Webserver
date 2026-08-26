#!/usr/bin/env python3
"""Grant a Firebase Authentication user the custom admin claim.

Run only from a trusted computer with a local service-account JSON. The user
must sign out and in afterward so their ID token receives the new claim.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import firebase_admin
from firebase_admin import auth, credentials


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("uid", help="Firebase Authentication UID to make an administrator")
    parser.add_argument("--service-account", required=True, type=Path)
    args = parser.parse_args()
    if not args.service_account.is_file():
        parser.error(f"No service-account JSON at {args.service_account}")
    firebase_admin.initialize_app(credentials.Certificate(str(args.service_account)))
    auth.set_custom_user_claims(args.uid, {"admin": True})
    print(f"Granted admin custom claim to {args.uid}. They must sign out/in before using the dashboard.")


if __name__ == "__main__":
    main()
