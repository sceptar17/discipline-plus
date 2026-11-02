-- Weekdays a habit repeats on (0 = Sunday ... 6 = Saturday). Empty means it is only added to days by hand.
ALTER TABLE exercises ADD COLUMN repeat_days TEXT NOT NULL DEFAULT '[]';
