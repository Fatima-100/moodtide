/* MoodTide - Table Name Alias Views
   The schema uses `song_genres` but the backend queries `Song_Genre`.
   This script creates a view alias so the backend works without code changes.
   Run this AFTER 01_schema.sql in the MoodTide database. */

USE MoodTide;
GO

-- Create a view alias: Song_Genre -> song_genres
-- (SQL Server is case-insensitive but the table name must match exactly)
IF OBJECT_ID('dbo.Song_Genre', 'V') IS NOT NULL DROP VIEW dbo.Song_Genre;
GO
CREATE VIEW dbo.Song_Genre AS SELECT * FROM dbo.song_genres;
GO

PRINT 'Song_Genre view alias created successfully.';
GO
SELECT name, definition FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID('dbo.Implicit_Signals');

SELECT p.name, p.description, p.created_at, ps.[position], s.title
FROM dbo.Playlists p
LEFT JOIN dbo.Playlist_Songs ps ON ps.playlist_id = p.playlist_id
LEFT JOIN dbo.Songs s ON s.song_id = ps.song_id
ORDER BY p.created_at DESC, ps.[position];

SELECT g.name, COUNT(*) AS songs
FROM dbo.Songs s
JOIN dbo.Song_Genre sg ON sg.song_id = s.song_id
JOIN dbo.Genres g ON g.genre_id = sg.genre_id
WHERE s.is_active = 1
GROUP BY g.name;


UPDATE dbo.Songs SET is_active = 0
WHERE title LIKE '%how to%' OR title LIKE '%what%difference%' OR title LIKE '%tutorial%';


ALTER TABLE dbo.Songs ADD region NVARCHAR(20) NOT NULL CONSTRAINT DF_Songs_region DEFAULT 'international';
ALTER TABLE dbo.Users ADD region_pref NVARCHAR(20) NOT NULL CONSTRAINT DF_Users_region DEFAULT 'all';
GO
UPDATE s SET s.region = 'pakistani'
FROM dbo.Songs s
JOIN dbo.Song_Genre sg ON sg.song_id = s.song_id
JOIN dbo.Genres g ON g.genre_id = sg.genre_id
WHERE g.name = 'Pakistani';


SELECT DISTINCT ar.name FROM dbo.Songs s JOIN dbo.Artists ar ON ar.artist_id = s.artist_id WHERE s.region = 'pakistani' ORDER BY ar.name;


   SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
   FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_NAME IN ('Songs','Artists','Albums','Song_Features')
   ORDER BY TABLE_NAME, ORDINAL_POSITION;


      SELECT name, definition FROM sys.check_constraints
   WHERE parent_object_id = OBJECT_ID('dbo.songs');

      SELECT 'Mood_Checkins' AS tbl, COUNT(*) AS n FROM dbo.Mood_Checkins
   UNION ALL SELECT 'Mood_Scores', COUNT(*) FROM dbo.Mood_Scores
   UNION ALL SELECT 'Listening_History', COUNT(*) FROM dbo.Listening_History
   UNION ALL SELECT 'Song_Impact', COUNT(*) FROM dbo.Song_Impact;