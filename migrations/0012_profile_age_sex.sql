-- Age and sex let Progress compare lifts with norms for someone your size and age.
ALTER TABLE coaching_profiles ADD COLUMN birth_year INTEGER;
ALTER TABLE coaching_profiles ADD COLUMN sex TEXT CHECK (sex IS NULL OR sex IN ('male', 'female'));
-- Show PowerBlock pin colors next to dumbbell weights.
ALTER TABLE coaching_profiles ADD COLUMN powerblock_colors INTEGER NOT NULL DEFAULT 1 CHECK (powerblock_colors IN (0, 1));
