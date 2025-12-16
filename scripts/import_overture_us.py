#!/usr/bin/env python3
"""
Import US POIs from Overture Maps into Supabase.

- If a POI doesn't exist: INSERT it
- If a POI exists: UPDATE it (upsert)

Usage:
    python import_overture_us.py

Options:
    --limit N       Only import N records (for testing)
    --category CAT  Only import specific category (e.g., 'restaurant')
    --state ST      Only import specific state (e.g., 'CA')
    --dry-run       Just count records, don't import
    --yes           Skip confirmation prompt

Future: For incremental updates using GERS changelog, see:
https://docs.overturemaps.org/gers/changelog/
"""

import os
import sys
import json
import argparse
from datetime import datetime
from pathlib import Path
from typing import Optional

import duckdb
from dotenv import load_dotenv
from supabase import create_client
from tqdm import tqdm

# Load .env from parent directory (mapierhub/.env)
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

# Configuration
OVERTURE_VERSION = "2025-11-19.0"
OVERTURE_PATH = f"s3://overturemaps-us-west-2/release/{OVERTURE_VERSION}/theme=places/*/*"
BATCH_SIZE = 500


def get_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")

    if not url or not key:
        print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables required")
        sys.exit(1)

    return create_client(url, key)


def setup_duckdb():
    con = duckdb.connect()
    con.execute("INSTALL spatial; INSTALL httpfs;")
    con.execute("LOAD spatial; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    return con


def build_query(
    limit: Optional[int] = None,
    category: Optional[str] = None,
    state: Optional[str] = None
) -> str:
    """Build the DuckDB query for extracting US POIs."""

    where_clauses = [
        "addresses[1].country = 'US'",
        # Filter to continental US + Alaska + Hawaii coordinates
        "ST_X(geometry) BETWEEN -180 AND -65",
        "ST_Y(geometry) BETWEEN 18 AND 72"
    ]

    if category:
        where_clauses.append(f"categories.primary = '{category}'")

    if state:
        where_clauses.append(f"addresses[1].region = '{state}'")

    where_clause = " AND ".join(where_clauses)

    query = f"""
    SELECT
        id,
        names.primary AS name,
        confidence,
        categories.primary AS primary_category,
        categories.alternate AS alternate_categories,
        brand.names.primary AS brand,
        operating_status,
        websites,
        socials,
        phones,
        emails,
        addresses[1].freeform AS street,
        addresses[1].locality AS city,
        addresses[1].region AS state,
        addresses[1].postcode AS postcode,
        addresses[1].country AS country,
        ST_X(geometry) AS lon,
        ST_Y(geometry) AS lat,
        to_json(struct_pack(
            sources := sources,
            bbox := bbox,
            version := version,
            basic_category := basic_category
        )) AS raw
    FROM read_parquet('{OVERTURE_PATH}')
    WHERE {where_clause}
    """

    if limit:
        query += f" LIMIT {limit}"

    return query


def transform_record(row: tuple, columns: list) -> dict:
    """Transform a DuckDB row to a Supabase-compatible dict."""
    record = dict(zip(columns, row))

    # Handle arrays - convert DuckDB arrays to Python lists
    for arr_field in ['alternate_categories', 'websites', 'socials', 'phones', 'emails']:
        if record[arr_field]:
            record[arr_field] = list(record[arr_field])
        else:
            record[arr_field] = None

    # Handle JSON
    if record['raw']:
        if isinstance(record['raw'], str):
            record['raw'] = json.loads(record['raw'])
        elif isinstance(record['raw'], dict):
            record['raw'] = json.loads(json.dumps(record['raw'], default=str))

    # Add metadata
    record['overture_version'] = OVERTURE_VERSION
    record['overture_updated_at'] = datetime.utcnow().isoformat()
    record['updated_at'] = datetime.utcnow().isoformat()

    return record


def count_records(con: duckdb.DuckDBPyConnection, category: Optional[str], state: Optional[str]) -> int:
    """Count total records to import."""
    where_clauses = [
        "addresses[1].country = 'US'",
        "ST_X(geometry) BETWEEN -180 AND -65",
        "ST_Y(geometry) BETWEEN 18 AND 72"
    ]

    if category:
        where_clauses.append(f"categories.primary = '{category}'")
    if state:
        where_clauses.append(f"addresses[1].region = '{state}'")

    where_clause = " AND ".join(where_clauses)

    count_query = f"""
    SELECT COUNT(*) FROM read_parquet('{OVERTURE_PATH}')
    WHERE {where_clause}
    """

    result = con.execute(count_query).fetchone()
    return result[0]


def main():
    parser = argparse.ArgumentParser(description="Import US POIs from Overture Maps")
    parser.add_argument("--limit", type=int, help="Limit number of records to import")
    parser.add_argument("--category", type=str, help="Filter by category (e.g., 'restaurant')")
    parser.add_argument("--state", type=str, help="Filter by state (e.g., 'CA')")
    parser.add_argument("--dry-run", action="store_true", help="Don't actually insert, just show stats")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()

    print("=" * 60)
    print("Overture Maps US POI Importer")
    print(f"Version: {OVERTURE_VERSION}")
    print("=" * 60)

    print("\nSetting up connections...")
    supabase = get_supabase_client()
    con = setup_duckdb()

    # Count total records
    print("Counting records to import (this may take a few minutes)...")
    total = count_records(con, args.category, args.state)

    if args.limit:
        total = min(total, args.limit)

    print(f"\nRecords to import: {total:,}")

    if args.category:
        print(f"  Filtered by category: {args.category}")
    if args.state:
        print(f"  Filtered by state: {args.state}")

    if args.dry_run:
        print("\n[Dry run] - exiting without import")
        return

    # Confirm for large imports
    if total > 10000 and not args.yes:
        confirm = input(f"\nThis will upsert {total:,} records. Continue? [y/N] ")
        if confirm.lower() != 'y':
            print("Aborted.")
            return

    # Build query
    query = build_query(
        limit=args.limit,
        category=args.category,
        state=args.state
    )

    columns = [
        'id', 'name', 'confidence', 'primary_category', 'alternate_categories',
        'brand', 'operating_status', 'websites', 'socials', 'phones', 'emails',
        'street', 'city', 'state', 'postcode', 'country', 'lon', 'lat', 'raw'
    ]

    print(f"\nImporting in batches of {BATCH_SIZE}...")

    # Execute query and fetch in batches
    result = con.execute(query)

    imported = 0
    errors = 0
    error_samples = []

    with tqdm(total=total, desc="Importing", unit="pois") as pbar:
        while True:
            rows = result.fetchmany(BATCH_SIZE)
            if not rows:
                break

            batch = []
            for row in rows:
                try:
                    record = transform_record(row, columns)
                    batch.append(record)
                except Exception as e:
                    errors += 1
                    if len(error_samples) < 5:
                        error_samples.append(f"Transform error: {e}")

            if batch:
                try:
                    # Upsert batch - inserts new records, updates existing
                    supabase.table('places').upsert(
                        batch,
                        on_conflict='id'
                    ).execute()
                    imported += len(batch)
                except Exception as e:
                    # Try one by one on batch failure
                    for record in batch:
                        try:
                            supabase.table('places').upsert(
                                record,
                                on_conflict='id'
                            ).execute()
                            imported += 1
                        except Exception as e2:
                            errors += 1
                            if len(error_samples) < 5:
                                error_samples.append(f"Insert error for {record.get('id', '?')}: {e2}")

            pbar.update(len(rows))

    print(f"\n{'=' * 60}")
    print("Import complete!")
    print(f"  Imported/Updated: {imported:,}")
    print(f"  Errors: {errors:,}")

    if error_samples:
        print("\nSample errors:")
        for err in error_samples:
            print(f"  - {err}")

    # Update geometry column
    print("\nNote: Run this SQL to update geometry column:")
    print("""
    UPDATE places
    SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)
    WHERE geom IS NULL AND lon IS NOT NULL AND lat IS NOT NULL;
    """)

    print(f"\n{'=' * 60}")
    print("Done!")


if __name__ == "__main__":
    main()
