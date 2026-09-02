#!/usr/bin/env python3
"""
Safaricom Daraja M-Pesa STK Push (Lipa na M-Pesa Online) Trigger Script.

Reads Daraja API configuration from environment variables or a .env file,
generates an OAuth bearer token, builds the Base64 password, and initiates
an Express STK Push prompt to the specified customer phone number.

Usage:
    python3 stk_push.py --phone 0705275647 --amount 200 --account INK_WITNESS

Environment Variables:
    MPESA_CONSUMER_KEY     : Daraja App Consumer Key
    MPESA_CONSUMER_SECRET  : Daraja App Consumer Secret
    MPESA_SHORTCODE        : Business Shortcode (Default: "174379")
    MPESA_PASSKEY         : Lipa Na M-Pesa Online Passkey
    MPESA_ENV              : "sandbox" or "production" (Default: "sandbox")
    APP_URL                : Base URL for callback endpoint
"""

import os
import sys
import base64
import json
import argparse
from datetime import datetime
import urllib.request
import urllib.parse
import urllib.error


def load_env_file(env_path=".env"):
    """Optionally load key-value pairs from a local .env file into os.environ."""
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key and not os.environ.get(key):
                    os.environ[key] = val


def format_phone_number(phone_str: str) -> str:
    """Format Kenyan phone numbers to international standard 2547XXXXXXXX or 2541XXXXXXXX."""
    cleaned = "".join(filter(str.isdigit, str(phone_str)))
    if cleaned.startswith("0") and len(cleaned) == 10:
        return "254" + cleaned[1:]
    elif cleaned.startswith("7") or cleaned.startswith("1") and len(cleaned) == 9:
        return "254" + cleaned
    elif cleaned.startswith("254") and len(cleaned) == 12:
        return cleaned
    elif cleaned.startswith("+254") and len(cleaned) == 13:
        return cleaned[1:]
    else:
        raise ValueError(f"Invalid Kenyan phone number format: '{phone_str}'. Expected 07XXXXXXXX or 2547XXXXXXXX.")


def get_oauth_token(consumer_key: str, consumer_secret: str, base_url: str) -> str:
    """Fetch OAuth 2.0 Access Token from Daraja OAuth Endpoint."""
    url = f"{base_url}/oauth/v1/generate?grant_type=client_credentials"
    auth_str = f"{consumer_key}:{consumer_secret}"
    b64_auth = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")

    headers = {
        "Authorization": f"Basic {b64_auth}",
        "Content-Type": "application/json",
    }

    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode("utf-8"))
            token = data.get("access_token")
            if not token:
                raise RuntimeError(f"Failed to obtain token from response: {data}")
            return token
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        raise RuntimeError(f"Daraja OAuth Token HTTP Error {e.code}: {error_body}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error connecting to Daraja OAuth endpoint: {e.reason}") from e


def trigger_stk_push(
    phone_number: str,
    amount: int,
    account_ref: str = "INK_WITNESS",
    transaction_desc: str = "Article Monograph Unlock",
    payment_type: str = "till",
    till_number: str = None
):
    """Generates password and triggers Daraja STK Push (CustomerBuyGoodsOnline for Till, CustomerPayBillOnline for Paybill)."""
    # 1. Load configuration from environment
    load_env_file()

    env = os.getenv("MPESA_ENV", "production").strip().lower()
    base_url = "https://api.safaricom.co.ke" if env == "production" else "https://sandbox.safaricom.co.ke"

    shortcode = os.getenv("MPESA_SHORTCODE", "").strip()
    passkey = os.getenv("MPESA_PASSKEY", "").strip()
    consumer_key = os.getenv("MPESA_CONSUMER_KEY", "").strip()
    consumer_secret = os.getenv("MPESA_CONSUMER_SECRET", "").strip()
    till = till_number or os.getenv("MPESA_TILL_NUMBER", "").strip()
    store = os.getenv("MPESA_STORE_NUMBER", shortcode).strip() or shortcode

    if not consumer_key or not consumer_secret or not passkey or not shortcode:
        raise ValueError(
            "Missing M-Pesa credentials in environment variables (MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_PASSKEY, MPESA_SHORTCODE). "
            "Please configure these secrets in deployment environment."
        )

    app_url = os.getenv("APP_URL", "https://localhost:3000").rstrip("/")
    callback_url = f"{app_url}/api/mpesa/callback"

    formatted_phone = format_phone_number(phone_number)

    is_till = (payment_type or os.getenv("MPESA_PAYMENT_TYPE", "till")).lower() == "till"

    if is_till and env == "production" and shortcode != "174379":
        transaction_type = "CustomerBuyGoodsOnline"
        business_short_code = store
        party_b = till
    else:
        transaction_type = "CustomerPayBillOnline"
        business_short_code = shortcode
        party_b = shortcode

    print("==================================================")
    print("🚀 DARAJA M-PESA EXPRESS STK PUSH TRIGGER")
    print("==================================================")
    print(f"• Environment     : {env.upper()} ({base_url})")
    print(f"• Payment Type    : {'BUY GOODS (TILL)' if is_till else 'PAYBILL'}")
    if is_till:
        print(f"• Till Number     : {till}")
        print(f"• Store Code      : {business_short_code}")
    else:
        print(f"• Paybill Code    : {business_short_code}")
    print(f"• Transaction Type: {transaction_type}")
    print(f"• Target Phone    : {formatted_phone} (Original: {phone_number})")
    print(f"• Amount (KES)    : KES {amount}")
    print(f"• Account Ref     : {account_ref}")
    print(f"• Callback URL    : {callback_url}")
    print("--------------------------------------------------")

    # Check credentials
    if not consumer_key or not consumer_secret:
        print("⚠️ WARNING: MPESA_CONSUMER_KEY or MPESA_CONSUMER_SECRET environment variables are empty.")
        print("   If testing locally in Sandbox without credentials, ensure credentials are set in .env or environment.")

    # 2. Generate Timestamp & Security Password
    # Timestamp format: YYYYMMDDHHmmss
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    raw_password = f"{business_short_code}{passkey}{timestamp}"
    password_b64 = base64.b64encode(raw_password.encode("utf-8")).decode("utf-8")

    # 3. Obtain OAuth Token
    print("🔑 Authenticating with Safaricom Daraja API...")
    try:
        access_token = get_oauth_token(consumer_key, consumer_secret, base_url)
        print("✅ OAuth Authentication Token Acquired Successfully.")
    except Exception as err:
        print(f"❌ OAuth Authentication Failed: {err}")
        sys.exit(1)

    # 4. Construct STK Push Payload
    stk_url = f"{base_url}/mpesa/stkpush/v1/processrequest"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    payload = {
        "BusinessShortCode": business_short_code,
        "Password": password_b64,
        "Timestamp": timestamp,
        "TransactionType": transaction_type,
        "Amount": int(amount),
        "PartyA": formatted_phone,
        "PartyB": party_b,
        "PhoneNumber": formatted_phone,
        "CallBackURL": callback_url,
        "AccountReference": account_ref[:12],
        "TransactionDesc": transaction_desc[:20],
    }

    print(f"\n📲 Dispatching STK Push ({transaction_type}) Request Payload to Daraja...")
    req = urllib.request.Request(
        stk_url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST"
    )

    try:
        with urllib.request.urlopen(req) as resp:
            response_data = json.loads(resp.read().decode("utf-8"))
            print("\n✅ STK PUSH INITIATED SUCCESSFULLY!")
            print("==================================================")
            print(json.dumps(response_data, indent=2))
            print("==================================================")
            print(f"📱 Customer ({formatted_phone}) should now see the M-Pesa PIN prompt for KES {amount} to Till {till if is_till else shortcode}.")
            return response_data
    except urllib.error.HTTPError as e:
        error_resp = e.read().decode("utf-8")
        print(f"\n❌ STK Push Failed [HTTP {e.code}]:")
        print(error_resp)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"\n❌ Network Connection Error: {e.reason}")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Trigger Safaricom Daraja M-Pesa STK Push.")
    parser.add_argument("--phone", "-p", default="0705275647", help="Customer phone number (e.g., 0705275647 or 254705275647)")
    parser.add_argument("--amount", "-a", type=int, default=200, help="Amount in KES (minimum 1)")
    parser.add_argument("--type", "-t", choices=["till", "paybill"], default="till", help="Payment type (till or paybill)")
    parser.add_argument("--till", default="1595174", help="Till number (for Buy Goods)")
    parser.add_argument("--account", "-ref", default="INK_WITNESS", help="Account Reference name")
    parser.add_argument("--desc", "-d", default="Monograph Unlock", help="Transaction Description")

    args = parser.parse_args()

    try:
        trigger_stk_push(
            phone_number=args.phone,
            amount=args.amount,
            account_ref=args.account,
            transaction_desc=args.desc,
            payment_type=args.type,
            till_number=args.till
        )
    except KeyboardInterrupt:
        print("\nOperation cancelled by user.")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
