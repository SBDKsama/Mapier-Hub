-- Migration: 003_add_bounded_search.sql
CREATE OR REPLACE FUNCTION search_places_bounds(
  ne_lat DOUBLE PRECISION,
  ne_lon DOUBLE PRECISION,
  sw_lat DOUBLE PRECISION,
  sw_lon DOUBLE PRECISION,
  p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  primary_category TEXT,
  alternate_categories TEXT[],
  confidence DOUBLE PRECISION,
  socials TEXT[],
  websites TEXT[],
  phones TEXT[],
  emails TEXT[],
  street TEXT,
  city TEXT,
  state TEXT,
  postcode TEXT,
  country TEXT,
  brand TEXT,
  operating_status TEXT,
  google_place_id TEXT,
  raw JSONB,
  distance_meters DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.lat,
    p.lon,
    p.primary_category,
    p.alternate_categories,
    p.confidence,
    p.socials,
    p.websites,
    p.phones,
    p.emails,
    p.street,
    p.city,
    p.state,
    p.postcode,
    p.country,
    p.brand,
    p.operating_status,
    p.google_place_id,
    p.raw,
    0.0::DOUBLE PRECISION as distance_meters
  FROM places p
  WHERE ST_Within(
    p.geom,
    ST_MakeEnvelope(sw_lon, sw_lat, ne_lon, ne_lat, 4326)
  )
  ORDER BY p.name
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
