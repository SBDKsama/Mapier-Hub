#!/usr/bin/env python3
"""
Clear all places from the Supabase database.

Usage:
    python clear_places.py
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

# Load .env from parent directory (mapierhub/.env)
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)


def get_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")

    if not url or not key:
        print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables required")
        sys.exit(1)

    return create_client(url, key)


def main():
    supabase = get_supabase_client()

    # Get current count
    result = supabase.table('places').select('id', count='exact').limit(0).execute()
    total = result.count

    if total == 0:
        print("Places table is already empty.")
        return

    print(f"Current places count: {total:,}")
    confirm = input("Are you sure you want to delete ALL places? [y/N] ")

    if confirm.lower() != 'y':
        print("Aborted.")
        return

    print("Clearing places...")

    # Delete in batches to avoid timeout
    deleted = 0
    while True:
        result = supabase.table('places').select('id').limit(1000).execute()
        if not result.data:
            break

        ids = [r['id'] for r in result.data]
        supabase.table('places').delete().in_('id', ids).execute()
        deleted += len(ids)
        print(f"  Deleted {deleted:,} / {total:,}")

    print(f"\nDone! Deleted {deleted:,} places.")


if __name__ == "__main__":
    main()
