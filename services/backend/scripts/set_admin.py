from __future__ import annotations

import argparse
import os
from pathlib import Path

import firebase_admin
from dotenv import load_dotenv
from firebase_admin import auth, credentials


def main() -> None:
    parser = argparse.ArgumentParser(description="Grant or remove the SIC Firebase administrator claim")
    parser.add_argument("email", nargs="+", help="One or more existing Firebase Authentication email addresses")
    parser.add_argument("--remove", action="store_true")
    args = parser.parse_args()

    backend_root = Path(__file__).resolve().parents[1]
    load_dotenv(backend_root / ".env")
    service_account = os.getenv("FIREBASE_SERVICE_ACCOUNT")
    if not service_account:
        raise SystemExit("FIREBASE_SERVICE_ACCOUNT is missing from services/backend/.env")
    service_account_path = Path(service_account).expanduser()
    if not service_account_path.is_file():
        raise SystemExit(
            "Firebase service-account JSON was not found at "
            f"{service_account_path}. Download it from Firebase Console > Project settings > "
            "Service accounts > Generate new private key, then run this command again."
        )
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(str(service_account_path)))

    for email in args.email:
        try:
            user = auth.get_user_by_email(email)
        except auth.UserNotFoundError as exc:
            raise SystemExit(f"No Firebase Authentication account exists for {email}. Create the account first.") from exc
        claims = dict(user.custom_claims or {})
        if args.remove:
            claims.pop("admin", None)
        else:
            claims["admin"] = True
        auth.set_custom_user_claims(user.uid, claims)
        action = "Removed administrator access from" if args.remove else "Granted administrator access to"
        print(f"{action} {email}.")
    print("Affected users must sign out and sign in again to refresh their tokens.")


if __name__ == "__main__":
    main()
