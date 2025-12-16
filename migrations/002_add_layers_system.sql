-- Migration: 002_add_layers_system.sql
-- Description: Adds support for map layers and linking places to specific layer data (e.g. Refugee Restrooms)

-- 1. Create layers table
CREATE TABLE IF NOT EXISTS layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT, -- 'api', 'dataset', 'user'
  icon_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Create place_layers table (Join table for Many-to-Many rlshp between Places and Layers, with extra data)
CREATE TABLE IF NOT EXISTS place_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id TEXT REFERENCES places(id) ON DELETE CASCADE, -- Note: places.id is TEXT in our schema, not UUID
  layer_id UUID REFERENCES layers(id) ON DELETE CASCADE,
  layer_data JSONB DEFAULT '{}',
  external_id TEXT, -- ID in the external system (e.g. refuge_123)
  last_synced TIMESTAMP DEFAULT NOW(),
  UNIQUE(place_id, layer_id)
);

-- 3. Create indexes
CREATE INDEX IF NOT EXISTS idx_place_layers_place_id ON place_layers(place_id);
CREATE INDEX IF NOT EXISTS idx_place_layers_external_id ON place_layers(external_id);

-- 4. Seed Refugee Restroom layer
INSERT INTO layers (slug, name, source_type)
VALUES ('refugee-restroom', 'Refugee Restroom', 'api')
ON CONFLICT (slug) DO NOTHING;
