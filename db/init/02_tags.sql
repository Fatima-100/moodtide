/* MoodTide A14: song tags and the "trending in Pakistan" list.
   Location: db/init/02_tags.sql. Safe to run more than once. */
CREATE TABLE IF NOT EXISTS song_tags (
    song_id  text     NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
    tag      text     NOT NULL CHECK (tag <> ''),
    weight   integer  NOT NULL CHECK (weight >= 0),   -- Last.fm count (0-100); fixed low value for Jamendo fallback
    source   text     NOT NULL DEFAULT 'lastfm_track'
             CHECK (source IN ('lastfm_track', 'lastfm_artist', 'jamendo')),
    PRIMARY KEY (song_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_song_tags_tag ON song_tags (tag);

CREATE TABLE IF NOT EXISTS chart_tracks (
    country     text         NOT NULL,
    position    integer      NOT NULL CHECK (position >= 1),
    title       text         NOT NULL,
    artist      text         NOT NULL,
    lastfm_url  text,
    song_id     text         REFERENCES songs(song_id) ON DELETE SET NULL,  -- set when the track is in our catalog
    fetched_at  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (country, position)
);
